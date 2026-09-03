CREATE TABLE IF NOT EXISTS public.plaid_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id text NOT NULL DEFAULT 'ins_127296',
  institution_name text NOT NULL DEFAULT 'Bluevine',
  item_id text NOT NULL UNIQUE,
  access_token text NOT NULL,
  account_id text,
  account_mask text,
  account_name text,
  status text NOT NULL DEFAULT 'active',
  linked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.plaid_items TO service_role;
ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.plaid_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid,
  transfer_id text UNIQUE,
  authorization_id text,
  direction text NOT NULL,
  amount_usd numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  failure_reason text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.plaid_transfers TO service_role;
GRANT SELECT ON public.plaid_transfers TO authenticated;
ALTER TABLE public.plaid_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can read transfers" ON public.plaid_transfers FOR SELECT TO authenticated USING (true);