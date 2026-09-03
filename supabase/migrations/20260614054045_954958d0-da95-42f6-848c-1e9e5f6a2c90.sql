ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS is_equitable_interest BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_cpi_dedupe_zip_price
  ON public.closing_pipeline_items (zip, base_contract_price);