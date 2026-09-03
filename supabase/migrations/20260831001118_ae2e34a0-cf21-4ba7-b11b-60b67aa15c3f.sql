ALTER TABLE public.buyer_buy_boxes
  ADD COLUMN IF NOT EXISTS debit_mandate_status text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS debit_mandate_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS debit_routing_number text,
  ADD COLUMN IF NOT EXISTS debit_account_number text,
  ADD COLUMN IF NOT EXISTS debit_account_holder text;

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS title_risk_score integer,
  ADD COLUMN IF NOT EXISTS title_underwritten_at timestamptz,
  ADD COLUMN IF NOT EXISTS algo_title_clear boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notary_status text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS notary_ref text,
  ADD COLUMN IF NOT EXISTS notary_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS flash_bridge_status text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS flash_bridge_amount_usd numeric,
  ADD COLUMN IF NOT EXISTS flash_bridge_at timestamptz,
  ADD COLUMN IF NOT EXISTS debit_pull_status text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS debit_pull_ref text,
  ADD COLUMN IF NOT EXISTS debit_pull_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cpi_debit_pull_status ON public.closing_pipeline_items (debit_pull_status);
CREATE INDEX IF NOT EXISTS idx_cpi_notary_status ON public.closing_pipeline_items (notary_status);