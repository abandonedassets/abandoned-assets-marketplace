ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS assignment_fee_intent_id text,
  ADD COLUMN IF NOT EXISTS assignment_fee_status text,
  ADD COLUMN IF NOT EXISTS assignment_fee_authorized_usd numeric,
  ADD COLUMN IF NOT EXISTS assignment_fee_authorized_at timestamptz,
  ADD COLUMN IF NOT EXISTS assignment_fee_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_abandoned_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_recovery_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cpi_assignment_fee_intent
  ON public.closing_pipeline_items (assignment_fee_intent_id)
  WHERE assignment_fee_intent_id IS NOT NULL;