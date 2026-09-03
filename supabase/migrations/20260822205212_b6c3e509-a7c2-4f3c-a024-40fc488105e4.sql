ALTER TABLE public.institutional_api_keys
  ADD COLUMN IF NOT EXISTS hmac_secret text,
  ADD COLUMN IF NOT EXISTS sandbox boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.m2m_idempotency_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid REFERENCES public.institutional_api_keys(id) ON DELETE CASCADE,
  client_txn_id text NOT NULL,
  endpoint text NOT NULL,
  request_hash text,
  http_status integer NOT NULL,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (api_key_id, client_txn_id)
);

GRANT ALL ON public.m2m_idempotency_receipts TO service_role;
ALTER TABLE public.m2m_idempotency_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read m2m receipts" ON public.m2m_idempotency_receipts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.m2m_idempotency_receipts TO authenticated;

CREATE TABLE IF NOT EXISTS public.uat_micro_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid REFERENCES public.institutional_api_keys(id) ON DELETE SET NULL,
  pipeline_item_id uuid,
  client_txn_id text,
  amount_usd numeric NOT NULL DEFAULT 0,
  signature_ok boolean NOT NULL DEFAULT false,
  handshake_status integer,
  rail_status text,
  rail_reference text,
  latency_ms integer,
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.uat_micro_settlements TO service_role;
ALTER TABLE public.uat_micro_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read uat settlements" ON public.uat_micro_settlements
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.uat_micro_settlements TO authenticated;

CREATE INDEX IF NOT EXISTS uat_micro_settlements_created_idx ON public.uat_micro_settlements (created_at DESC);
CREATE INDEX IF NOT EXISTS m2m_idem_receipts_created_idx ON public.m2m_idempotency_receipts (created_at DESC);