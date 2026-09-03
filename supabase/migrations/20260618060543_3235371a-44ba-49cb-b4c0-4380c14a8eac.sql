
-- ============ SHADOW ESCROW LEDGER ============
CREATE TABLE IF NOT EXISTS public.shadow_escrow_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid NOT NULL REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  user_id uuid,
  total_assignment_fee numeric NOT NULL DEFAULT 0,
  amount_secured numeric NOT NULL DEFAULT 0,
  amount_released numeric NOT NULL DEFAULT 0,
  liquidity_state text NOT NULL DEFAULT 'secured', -- secured | dripping | cleared
  velocity_days integer NOT NULL DEFAULT 14,
  drips_total integer NOT NULL DEFAULT 56, -- 14 days * 4 drips/day (every 6h)
  drips_completed integer NOT NULL DEFAULT 0,
  next_drip_at timestamptz NOT NULL DEFAULT now() + interval '6 hours',
  last_dispatch_response jsonb,
  last_dispatch_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_item_id)
);

GRANT SELECT ON public.shadow_escrow_ledger TO authenticated;
GRANT ALL ON public.shadow_escrow_ledger TO service_role;

ALTER TABLE public.shadow_escrow_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sel_owner_read" ON public.shadow_escrow_ledger
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "sel_admin_all" ON public.shadow_escrow_ledger
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_sel_active_next_drip
  ON public.shadow_escrow_ledger(next_drip_at)
  WHERE liquidity_state IN ('secured','dripping');

CREATE TRIGGER trg_sel_updated_at
  BEFORE UPDATE ON public.shadow_escrow_ledger
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Virtual funding credit on the asset
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS virtual_funding_credit numeric NOT NULL DEFAULT 0;

-- ============ AUTO-CREATE LEDGER ON CLEAR ============
CREATE OR REPLACE FUNCTION public.cpi_open_shadow_escrow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _fee numeric; _velocity integer;
BEGIN
  IF NEW.status::text <> 'Funds-Cleared' THEN RETURN NEW; END IF;
  IF OLD.status::text = 'Funds-Cleared' THEN RETURN NEW; END IF;

  _fee := COALESCE(NEW.cleared_amount, NEW.optimized_acquisition_premium, 0);
  IF _fee <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE((value)::text::integer, 14) INTO _velocity
  FROM public.system_config WHERE key = 'shadow_escrow_velocity_days';
  IF _velocity IS NULL OR _velocity < 1 THEN _velocity := 14; END IF;

  INSERT INTO public.shadow_escrow_ledger(
    pipeline_item_id, user_id, total_assignment_fee, amount_secured,
    liquidity_state, velocity_days, drips_total, next_drip_at
  ) VALUES (
    NEW.id, NEW.user_id, _fee, _fee,
    'secured', _velocity, _velocity * 4, now() + interval '6 hours'
  ) ON CONFLICT (pipeline_item_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_open_shadow_escrow ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_open_shadow_escrow
  AFTER UPDATE OF status ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_open_shadow_escrow();

INSERT INTO public.system_config(key, value)
VALUES ('shadow_escrow_velocity_days', '14'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============ DRIP FUNCTION (every 6h) ============
CREATE OR REPLACE FUNCTION public.drip_shadow_escrow()
RETURNS TABLE(ledger_id uuid, tranche numeric, released_total numeric, state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _r RECORD;
  _remaining_fee numeric;
  _remaining_drips integer;
  _tranche numeric;
  _new_total numeric;
  _new_state text;
  _new_completed integer;
BEGIN
  FOR _r IN
    SELECT id, total_assignment_fee, amount_released, drips_total, drips_completed
    FROM public.shadow_escrow_ledger
    WHERE liquidity_state IN ('secured','dripping')
      AND next_drip_at <= now()
    ORDER BY next_drip_at ASC
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      _remaining_fee := GREATEST(_r.total_assignment_fee - _r.amount_released, 0);
      _remaining_drips := GREATEST(_r.drips_total - _r.drips_completed, 1);
      _tranche := ROUND((_remaining_fee / _remaining_drips)::numeric, 2);
      IF _tranche < 0.01 THEN _tranche := _remaining_fee; END IF;

      _new_total := LEAST(_r.amount_released + _tranche, _r.total_assignment_fee);
      _new_completed := _r.drips_completed + 1;
      _new_state := CASE
        WHEN _new_total >= _r.total_assignment_fee THEN 'cleared'
        ELSE 'dripping'
      END;

      UPDATE public.shadow_escrow_ledger SET
        amount_released = _new_total,
        drips_completed = _new_completed,
        liquidity_state = _new_state,
        next_drip_at = CASE WHEN _new_state = 'cleared'
                            THEN next_drip_at
                            ELSE now() + interval '6 hours' END,
        updated_at = now()
      WHERE id = _r.id;

      ledger_id := _r.id; tranche := _tranche; released_total := _new_total; state := _new_state;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- Fail-forward
      INSERT INTO public.system_alerts(severity, kind, message, metadata)
      VALUES ('low','shadow_drip_error', SQLERRM,
        jsonb_build_object('ledger_id', _r.id, 'sqlstate', SQLSTATE));
    END;
  END LOOP;
END;
$$;

-- ============ CAPITAL RE-ALLOCATION ON NEW ASSET ============
CREATE OR REPLACE FUNCTION public.cpi_apply_virtual_funding_credit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _available numeric;
  _need numeric;
  _credit numeric;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.virtual_funding_credit, 0) > 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(amount_secured - amount_released), 0) INTO _available
  FROM public.shadow_escrow_ledger
  WHERE user_id = NEW.user_id
    AND liquidity_state IN ('secured','dripping');

  IF _available <= 0 THEN RETURN NEW; END IF;

  _need := COALESCE(NEW.emd_amount, 0);
  IF _need <= 0 THEN RETURN NEW; END IF;

  _credit := LEAST(_need, ROUND(_available * 0.5, 2));
  IF _credit > 0 THEN
    NEW.virtual_funding_credit := _credit;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_virtual_funding ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_virtual_funding
  BEFORE INSERT ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_apply_virtual_funding_credit();
