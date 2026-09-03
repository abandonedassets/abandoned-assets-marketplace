
DO $$ BEGIN
  CREATE TYPE public.title_status_enum AS ENUM ('Insured','Uninsurable','Pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS title_status public.title_status_enum DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS requires_legal_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS title_notes text,
  ADD COLUMN IF NOT EXISTS priority_override boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_cpi_legal_review
  ON public.closing_pipeline_items(requires_legal_review)
  WHERE requires_legal_review = true;

CREATE OR REPLACE FUNCTION public.enforce_title_hardening()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _hay text;
BEGIN
  _hay := lower(coalesce(NEW.title_notes,'') || ' ' || coalesce(NEW.address,''));
  IF NEW.title_status = 'Uninsurable'
     OR _hay ~ '(quitclaim|quit-claim|quit claim|uninsurable)' THEN
    NEW.requires_legal_review := true;
    IF NEW.title_status IS DISTINCT FROM 'Uninsurable' THEN
      NEW.title_status := 'Uninsurable';
    END IF;
    IF NEW.status::text IN ('Locked-Escrow-Pending','Funds-Cleared') THEN
      RAISE EXCEPTION 'LEGAL_HOLD_BLOCK: asset requires title curative review before settlement'
        USING ERRCODE = 'P0001';
    END IF;
    NEW.escrow_status := 'LEGAL-HOLD';
    NEW.is_held := true;
    NEW.bundle_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_title_hardening ON public.closing_pipeline_items;
CREATE TRIGGER trg_enforce_title_hardening
  BEFORE INSERT OR UPDATE ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_title_hardening();

CREATE OR REPLACE FUNCTION public.alert_legal_hold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.requires_legal_review = true
     AND (TG_OP = 'INSERT' OR OLD.requires_legal_review IS DISTINCT FROM true) THEN
    INSERT INTO public.system_alerts(severity, kind, message, deal_id, metadata)
    VALUES ('high','legal_hold','Title risk detected — asset routed to LEGAL-HOLD',
      NEW.id,
      jsonb_build_object('address',NEW.address,'zip',NEW.zip,
                         'title_status',NEW.title_status,'title_notes',NEW.title_notes));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_legal_hold ON public.closing_pipeline_items;
CREATE TRIGGER trg_alert_legal_hold
  AFTER INSERT OR UPDATE OF requires_legal_review ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.alert_legal_hold();

CREATE OR REPLACE FUNCTION public.auto_clear_eligible_deals()
RETURNS TABLE(deal_id uuid, cleared_amount numeric, zip text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r RECORD; _amt NUMERIC; _evt TEXT;
BEGIN
  FOR _r IN
    SELECT id, zip, optimized_acquisition_premium, locked_at
    FROM public.closing_pipeline_items
    WHERE status = 'Locked-Escrow-Pending'::app_pipeline_status
      AND COALESCE(manual_review,false) = false
      AND COALESCE(is_stale,false) = false
      AND COALESCE(requires_legal_review,false) = false
      AND COALESCE(confidence_score,0) >= 50
      AND locked_at IS NOT NULL
      AND locked_at < now() - interval '30 seconds'
    FOR UPDATE SKIP LOCKED
  LOOP
    _amt := COALESCE(_r.optimized_acquisition_premium, 0);
    _evt := 'auto_clear:' || _r.id::text || ':' || extract(epoch from now())::bigint;
    UPDATE public.closing_pipeline_items SET
      status = 'Funds-Cleared'::app_pipeline_status,
      escrow_status = 'cleared', cleared_at = now(), cleared_amount = _amt,
      lock_expires_at = NULL, is_stale = false, updated_at = now()
    WHERE id = _r.id;
    INSERT INTO public.processed_ledger_events(event_id) VALUES (_evt) ON CONFLICT DO NOTHING;
    deal_id := _r.id; cleared_amount := _amt; zip := _r.zip;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.strike_lock_deal(_deal_id uuid, _key_id uuid)
RETURNS TABLE(id uuid, status text, locked_at timestamp with time zone, lock_expires_at timestamp with time zone, base_contract_price numeric, optimized_acquisition_premium numeric, zip text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.closing_pipeline_items;
BEGIN
  SELECT * INTO _row FROM public.closing_pipeline_items
    WHERE closing_pipeline_items.id = _deal_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF _row.requires_legal_review = true THEN
    RAISE EXCEPTION 'LEGAL_HOLD' USING ERRCODE='P0001';
  END IF;
  IF _row.manual_review = true THEN
    RAISE EXCEPTION 'MANUAL_REVIEW_REQUIRED' USING ERRCODE='P0001';
  END IF;
  IF _row.is_stale = true THEN
    RAISE EXCEPTION 'ASSET_STALE' USING ERRCODE='P0001';
  END IF;
  IF _row.status::text IN ('Locked-Escrow-Pending','Funds-Cleared','Closed','Dead','CRITICAL_STALL') OR _row.is_held = true THEN
    RAISE EXCEPTION 'ALREADY_CLEARED' USING ERRCODE='P0001';
  END IF;
  UPDATE public.closing_pipeline_items
    SET status='Locked-Escrow-Pending'::app_pipeline_status,
        escrow_status='pending_dispatch',
        locked_at=now(),
        lock_expires_at=now() + interval '24 hours',
        locked_by_key_id=_key_id
    WHERE closing_pipeline_items.id=_deal_id;
  RETURN QUERY
    SELECT c.id, c.status::text, c.locked_at, c.lock_expires_at, c.base_contract_price, c.optimized_acquisition_premium, c.zip
    FROM public.closing_pipeline_items c WHERE c.id=_deal_id;
END;
$$;

INSERT INTO public.closing_pipeline_items (
  external_id, address, city, state, zip, county,
  base_contract_price, optimized_acquisition_premium,
  status, source, is_equitable_interest,
  title_status, title_notes, priority_override
)
SELECT
  'manual:courtyard-cir-aurora-il',
  'Courtyard Cir', 'Aurora', 'IL', '60504', 'Kane',
  3100, 5000,
  'New', 'manual_injection', true,
  'Uninsurable',
  'Quitclaim deed in chain of custody — title curative required before any settlement. Priority override.',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.closing_pipeline_items
  WHERE external_id = 'manual:courtyard-cir-aurora-il'
);
