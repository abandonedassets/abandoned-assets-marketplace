ALTER TYPE public.app_pipeline_status ADD VALUE IF NOT EXISTS 'Funds-Suspended';

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS settlement_reference text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspension_reason text;

CREATE OR REPLACE FUNCTION public.enforce_settlement_anchor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status::text = 'Funds-Cleared' AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'Funds-Cleared') THEN
    IF NEW.cleared_at IS NULL
       OR COALESCE(NEW.cleared_amount, 0) <= 0
       OR COALESCE(NULLIF(TRIM(NEW.settlement_reference), ''), '') = '' THEN
      RAISE EXCEPTION 'SETTLEMENT_ANCHOR_MISSING: Funds-Cleared requires cleared_at, cleared_amount > 0, and settlement_reference';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_settlement_anchor ON public.closing_pipeline_items;
CREATE TRIGGER trg_enforce_settlement_anchor
BEFORE INSERT OR UPDATE ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_settlement_anchor();