ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS toll_status text,
  ADD COLUMN IF NOT EXISTS toll_intent_id text,
  ADD COLUMN IF NOT EXISTS toll_amount_usd numeric,
  ADD COLUMN IF NOT EXISTS toll_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS toll_session_url text,
  ADD COLUMN IF NOT EXISTS toll_buyer_key_id uuid,
  ADD COLUMN IF NOT EXISTS balance_rail_ref text,
  ADD COLUMN IF NOT EXISTS balance_rail_status text,
  ADD COLUMN IF NOT EXISTS balance_due_usd numeric,
  ADD COLUMN IF NOT EXISTS balance_instructed_at timestamptz;

ALTER TABLE public.institutional_api_keys
  ADD COLUMN IF NOT EXISTS cancellation_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blacklisted_at timestamptz,
  ADD COLUMN IF NOT EXISTS liquidity_score numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS last_ip_subnet text;

CREATE INDEX IF NOT EXISTS idx_cpi_toll_open
  ON public.closing_pipeline_items (toll_paid_at)
  WHERE toll_status = 'paid';