
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS auto_clearance_ready boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_auto_clearance_ready()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.auto_clearance_ready :=
    COALESCE(NEW.optimized_acquisition_premium, 0) >= 10000;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_auto_clearance_ready ON public.closing_pipeline_items;
CREATE TRIGGER trg_set_auto_clearance_ready
BEFORE INSERT OR UPDATE OF optimized_acquisition_premium
ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.set_auto_clearance_ready();

UPDATE public.closing_pipeline_items
SET auto_clearance_ready = (COALESCE(optimized_acquisition_premium, 0) >= 10000);
