ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS noi_usd numeric,
  ADD COLUMN IF NOT EXISTS wale_years numeric,
  ADD COLUMN IF NOT EXISTS dscr numeric,
  ADD COLUMN IF NOT EXISTS dscr_breach boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cre_package text;

CREATE INDEX IF NOT EXISTS cpi_dscr_breach_idx ON public.closing_pipeline_items (dscr_breach) WHERE dscr_breach;