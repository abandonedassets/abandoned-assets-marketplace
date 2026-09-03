ALTER TABLE public.inbound_wire_accounts
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'derived',
  ADD COLUMN IF NOT EXISTS provider_bank_account_id text,
  ADD COLUMN IF NOT EXISTS provider_account_number_id text;

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS payout_status text,
  ADD COLUMN IF NOT EXISTS payout_provider text,
  ADD COLUMN IF NOT EXISTS payout_provider_transfer_id text,
  ADD COLUMN IF NOT EXISTS seller_disbursement_id text,
  ADD COLUMN IF NOT EXISTS seller_disbursed_at timestamptz;