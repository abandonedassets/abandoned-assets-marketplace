
-- 1. PRE-BINDING MASTER PURCHASE COMMITMENTS
ALTER TABLE public.buyer_buy_boxes
  ADD COLUMN IF NOT EXISTS pre_binding_authorized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mpc_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS mpc_signature_name text,
  ADD COLUMN IF NOT EXISTS mpc_emd_authorized boolean NOT NULL DEFAULT false;

-- 2. DYNAMIC SPREAD COMPRESSION / EXPANSION
CREATE OR REPLACE FUNCTION public.buyer_density(_zip text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::int FROM public.buyer_buy_boxes b
  WHERE b.active = true AND b.deprecated_at IS NULL
    AND (_zip IS NULL OR cardinality(b.target_zip_codes) = 0 OR _zip = ANY(b.target_zip_codes));
$$;

CREATE OR REPLACE FUNCTION public.compute_dynamic_spread(_price numeric, _arv numeric, _zip text)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _base numeric; _d int;
BEGIN
  IF COALESCE(_price,0) <= 0 THEN RETURN 0; END IF;
  _base := public.compute_assignment_fee(_price, _arv);
  _d := public.buyer_density(_zip);
  IF _d >= 3 THEN
    RETURN LEAST(25000, GREATEST(10000, ROUND(_base * 1.5)));
  ELSIF _d <= 0 THEN
    RETURN LEAST(_base, 1000);
  END IF;
  RETURN _base;
END;
$$;

CREATE OR REPLACE FUNCTION public.cpi_dynamic_spread()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f numeric;
BEGIN
  IF NEW.base_contract_price IS NULL OR NEW.base_contract_price <= 0 THEN RETURN NEW; END IF;
  IF NEW.locked_at IS NOT NULL OR NEW.cleared_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT'
     OR NEW.base_contract_price IS DISTINCT FROM OLD.base_contract_price
     OR NEW.optimized_acquisition_premium IS DISTINCT FROM OLD.optimized_acquisition_premium THEN
    BEGIN
      _f := public.compute_dynamic_spread(NEW.base_contract_price, NEW.assessed_value, NEW.zip);
      IF _f IS NOT NULL AND _f > 0 THEN NEW.optimized_acquisition_premium := _f; END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_dynamic_spread ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_dynamic_spread
BEFORE INSERT OR UPDATE ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.cpi_dynamic_spread();

-- 3. PROGRAMMATIC LIEN / ENCUMBRANCE PRE-CLEARING
CREATE OR REPLACE FUNCTION public.cpi_lien_preclear()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _enc numeric;
BEGIN
  IF NEW.locked_at IS NOT NULL OR NEW.cleared_at IS NOT NULL THEN RETURN NEW; END IF;
  IF 'LIEN_ADJUSTED' = ANY(COALESCE(NEW.enrichment_tags,'{}')) THEN RETURN NEW; END IF;
  _enc := COALESCE(NEW.lien_total,0);
  IF _enc > 0 AND COALESCE(NEW.base_contract_price,0) > 0 THEN
    NEW.base_contract_price := GREATEST(500, NEW.base_contract_price - _enc);
    NEW.enrichment_tags := array_append(COALESCE(NEW.enrichment_tags,'{}'), 'LIEN_ADJUSTED');
    NEW.title_notes := COALESCE(NEW.title_notes,'') ||
      format(' [auto] net-clean adjustment -$%s for recorded liens/back taxes.', ROUND(_enc));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_lien_preclear ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_lien_preclear
BEFORE INSERT OR UPDATE ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.cpi_lien_preclear();

-- 4. EMD MICRO-HOLDS ON SIGN 3
ALTER TABLE public.esign_requests
  ADD COLUMN IF NOT EXISTS emd_hold_amount numeric NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS emd_hold_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS emd_hold_ref text,
  ADD COLUMN IF NOT EXISTS emd_hold_authorized_at timestamptz;

-- 5. TIME-DECAY CONTRACT RATCHETING
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS offer_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_stage text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.sweep_offer_ratchet()
RETURNS TABLE(deal_id uuid, action text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; _hrs numeric;
BEGIN
  FOR r IN
    SELECT id, offer_sent_at, offer_stage, base_contract_price, absolute_floor_price,
           optimized_acquisition_premium
    FROM public.closing_pipeline_items
    WHERE offer_sent_at IS NOT NULL
      AND cleared_at IS NULL AND locked_at IS NULL
      AND offer_stage <> 'rescinded'
    LIMIT 500
  LOOP
    BEGIN
      _hrs := EXTRACT(EPOCH FROM (now() - r.offer_sent_at)) / 3600.0;
      IF _hrs >= 48 AND r.offer_stage <> 'final' THEN
        IF COALESCE(r.optimized_acquisition_premium,0) > 1500 THEN
          UPDATE public.closing_pipeline_items
            SET offer_stage = 'final',
                base_contract_price = ROUND(base_contract_price * 1.03),
                offer_expires_at = now() + interval '24 hours'
            WHERE id = r.id;
          deal_id := r.id; action := 'step_up'; RETURN NEXT;
        ELSE
          UPDATE public.closing_pipeline_items
            SET offer_stage = 'rescinded', offer_expires_at = now()
            WHERE id = r.id;
          deal_id := r.id; action := 'rescinded'; RETURN NEXT;
        END IF;
      ELSIF _hrs >= 24 AND r.offer_stage IN ('none','standard') THEN
        UPDATE public.closing_pipeline_items
          SET offer_stage = 'adjustment', offer_expires_at = r.offer_sent_at + interval '48 hours'
          WHERE id = r.id;
        deal_id := r.id; action := 'market_adjustment_notice'; RETURN NEXT;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;
END;
$$;
