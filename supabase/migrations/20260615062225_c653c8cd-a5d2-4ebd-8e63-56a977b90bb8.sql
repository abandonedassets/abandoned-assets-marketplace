
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS county TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS closing_pipeline_items_external_id_uniq
  ON public.closing_pipeline_items (external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS closing_pipeline_items_zip_address_uniq
  ON public.closing_pipeline_items (zip, lower(address))
  WHERE address IS NOT NULL;
