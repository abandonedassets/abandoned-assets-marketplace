ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS is_dip boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dip_case_number text,
  ADD COLUMN IF NOT EXISTS dip_court_district text,
  ADD COLUMN IF NOT EXISTS dip_sale_motion_ref text,
  ADD COLUMN IF NOT EXISTS dip_proposed_order_ref text,
  ADD COLUMN IF NOT EXISTS dip_sale_hearing_at timestamptz,
  ADD COLUMN IF NOT EXISTS dip_closing_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS dip_free_and_clear boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stalking_horse_bid numeric,
  ADD COLUMN IF NOT EXISTS court_overbid_increment numeric;

CREATE INDEX IF NOT EXISTS idx_cpi_is_dip ON public.closing_pipeline_items (is_dip) WHERE is_dip;

CREATE OR REPLACE FUNCTION public.cpi_stamp_dip()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_dip OR NEW.dip_case_number IS NOT NULL OR NEW.asset_type = 'DIP_CHAPTER_11' THEN
    NEW.is_dip := true;
    IF NEW.contract_structure IS NULL THEN
      NEW.contract_structure := 'SECTION_363';
    END IF;
    -- Court-approved sale motion + proposed order = free & clear title
    IF NEW.dip_sale_motion_ref IS NOT NULL AND NEW.dip_proposed_order_ref IS NOT NULL THEN
      NEW.dip_free_and_clear := true;
      NEW.title_status := 'Insured'::title_status_enum;
      NEW.lien_total := 0;
    END IF;
    IF NEW.stalking_horse_bid IS NOT NULL AND NEW.court_overbid_increment IS NULL THEN
      NEW.court_overbid_increment := GREATEST(25000, round(NEW.stalking_horse_bid * 0.02));
    END IF;
    IF NEW.dip_closing_deadline_at IS NOT NULL THEN
      NEW.priority_override := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_stamp_dip ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_stamp_dip
BEFORE INSERT OR UPDATE ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.cpi_stamp_dip();