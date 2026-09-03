ALTER TABLE public.institutional_webhooks
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS schema_url text,
  ADD COLUMN IF NOT EXISTS schema_map jsonb,
  ADD COLUMN IF NOT EXISTS discovery_domain text,
  ADD COLUMN IF NOT EXISTS key_extended_at timestamptz;

CREATE TABLE IF NOT EXISTS public.m2m_discovery_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL UNIQUE,
  label text,
  active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'PENDING',
  schema_url text,
  schema_map jsonb,
  last_scanned_at timestamptz,
  last_status text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.m2m_discovery_targets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.m2m_discovery_targets TO authenticated;
ALTER TABLE public.m2m_discovery_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage discovery targets" ON public.m2m_discovery_targets;
CREATE POLICY "admins manage discovery targets" ON public.m2m_discovery_targets
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.escrow_injections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid,
  provider text NOT NULL DEFAULT 'qualia',
  order_ref text,
  http_status integer,
  status text NOT NULL DEFAULT 'PENDING',
  request_payload jsonb,
  response_body text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS escrow_injections_deal_unique
  ON public.escrow_injections (pipeline_item_id) WHERE status = 'OPENED';
GRANT ALL ON public.escrow_injections TO service_role;
GRANT SELECT ON public.escrow_injections TO authenticated;
ALTER TABLE public.escrow_injections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read escrow injections" ON public.escrow_injections;
CREATE POLICY "admins read escrow injections" ON public.escrow_injections
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));