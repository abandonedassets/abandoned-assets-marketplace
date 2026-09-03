ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS qi_entity text,
  ADD COLUMN IF NOT EXISTS is_1031_candidate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exchange_identified_at timestamptz,
  ADD COLUMN IF NOT EXISTS exchange_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS acreage numeric,
  ADD COLUMN IF NOT EXISTS timber_density_score numeric,
  ADD COLUMN IF NOT EXISTS like_kind_eligible boolean NOT NULL DEFAULT false;

ALTER TABLE public.buyer_buy_boxes
  ADD COLUMN IF NOT EXISTS is_1031_buyer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qi_entity text,
  ADD COLUMN IF NOT EXISTS exchange_deadline_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cpi_1031 ON public.closing_pipeline_items (is_1031_candidate) WHERE is_1031_candidate;
CREATE INDEX IF NOT EXISTS idx_cpi_like_kind ON public.closing_pipeline_items (like_kind_eligible) WHERE like_kind_eligible;