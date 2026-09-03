ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS fee_attribution text,
  ADD COLUMN IF NOT EXISTS has_timber boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_street_utilities boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS asset_class text,
  ADD COLUMN IF NOT EXISTS parcel_number text;

CREATE INDEX IF NOT EXISTS idx_cpi_source_system ON public.closing_pipeline_items (source_system);
CREATE INDEX IF NOT EXISTS idx_cpi_fee_attribution ON public.closing_pipeline_items (fee_attribution);