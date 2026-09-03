ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS reverse_strike_ready boolean NOT NULL DEFAULT false;

-- Backfill: mark any cleared / in-escrow / already-dispatched inventory as not reverse-strike-ready.
UPDATE public.closing_pipeline_items
   SET reverse_strike_ready = false
 WHERE reverse_strike_ready IS NULL;

-- Help the decay/gateway scans find ready rows quickly.
CREATE INDEX IF NOT EXISTS idx_cpi_reverse_strike_ready
  ON public.closing_pipeline_items (reverse_strike_ready)
  WHERE cleared_at IS NULL;

-- Keep existing grants intact; no new table, only a column addition.