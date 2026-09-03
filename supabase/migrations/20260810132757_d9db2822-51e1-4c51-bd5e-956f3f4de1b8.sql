ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS seller_email text,
  ADD COLUMN IF NOT EXISTS seller_phone text,
  ADD COLUMN IF NOT EXISTS seller_claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cpi_apn ON public.closing_pipeline_items (apn);