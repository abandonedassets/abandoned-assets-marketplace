
ALTER TYPE public.app_pipeline_status ADD VALUE IF NOT EXISTS 'Locked-Escrow-Pending';
ALTER TYPE public.app_pipeline_status ADD VALUE IF NOT EXISTS 'Funds-Cleared';

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS escrow_status TEXT,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by_key_id UUID REFERENCES public.institutional_api_keys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cleared_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_pipeline_escrow_status ON public.closing_pipeline_items(escrow_status);
CREATE INDEX IF NOT EXISTS idx_pipeline_locked_by ON public.closing_pipeline_items(locked_by_key_id);

CREATE OR REPLACE FUNCTION public.sync_bundle_on_deal_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  closed_statuses TEXT[] := ARRAY['Closed','Dead','CRITICAL_STALL','Locked-Escrow-Pending','Funds-Cleared'];
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    IF (NEW.is_held = true OR NEW.status::text = ANY(closed_statuses)) AND NEW.bundle_id IS NOT NULL THEN
      NEW.bundle_id := NULL;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.bundle_id IS DISTINCT FROM NEW.bundle_id AND OLD.bundle_id IS NOT NULL THEN
    PERFORM public.recalc_bundle_totals(OLD.bundle_id);
  END IF;
  IF TG_OP = 'DELETE' AND OLD.bundle_id IS NOT NULL THEN
    PERFORM public.recalc_bundle_totals(OLD.bundle_id);
    RETURN OLD;
  END IF;

  IF TG_OP IN ('INSERT','UPDATE') AND NEW.bundle_id IS NOT NULL THEN
    PERFORM public.recalc_bundle_totals(NEW.bundle_id);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.strike_lock_deal(_deal_id UUID, _key_id UUID)
RETURNS TABLE(id UUID, status TEXT, locked_at TIMESTAMPTZ, base_contract_price NUMERIC, optimized_acquisition_premium NUMERIC, zip TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.closing_pipeline_items;
BEGIN
  SELECT * INTO _row FROM public.closing_pipeline_items
    WHERE closing_pipeline_items.id = _deal_id
    FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF _row.status::text IN ('Locked-Escrow-Pending','Funds-Cleared','Closed','Dead','CRITICAL_STALL') OR _row.is_held = true THEN
    RAISE EXCEPTION 'ALREADY_CLEARED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.closing_pipeline_items
    SET status = 'Locked-Escrow-Pending'::app_pipeline_status,
        escrow_status = 'pending_dispatch',
        locked_at = now(),
        locked_by_key_id = _key_id
    WHERE closing_pipeline_items.id = _deal_id;

  RETURN QUERY
    SELECT c.id, c.status::text, c.locked_at, c.base_contract_price, c.optimized_acquisition_premium, c.zip
    FROM public.closing_pipeline_items c WHERE c.id = _deal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.strike_lock_deal(UUID, UUID) TO service_role;
