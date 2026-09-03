
ALTER TABLE public.bundles
  ADD COLUMN IF NOT EXISTS bulk_discount_pct NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS institutional_tape BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bundles_institutional_tape
  ON public.bundles(institutional_tape) WHERE institutional_tape = true;
