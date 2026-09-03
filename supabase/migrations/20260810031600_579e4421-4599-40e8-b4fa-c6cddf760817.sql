ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS calculated_arv numeric,
  ADD COLUMN IF NOT EXISTS arv_source text,
  ADD COLUMN IF NOT EXISTS arv_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS arv_comp_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_fee_positive boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_cpi_arv_updated_at ON public.closing_pipeline_items (arv_updated_at);