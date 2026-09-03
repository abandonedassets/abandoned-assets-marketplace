
CREATE TABLE IF NOT EXISTS public.inbound_wire_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid NOT NULL UNIQUE REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  fbo_account_number text NOT NULL UNIQUE,
  routing_number text NOT NULL,
  fbo_name text NOT NULL,
  bank_name text NOT NULL,
  expected_amount numeric,
  status text NOT NULL DEFAULT 'open',
  funded_amount numeric,
  funded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inbound_wire_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text,
  fbo_account_number text,
  amount_usd numeric,
  sender_reference text,
  matched_item_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'unmatched',
  reason text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iwe_created ON public.inbound_wire_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iwa_status ON public.inbound_wire_accounts (status);

GRANT SELECT ON public.inbound_wire_accounts TO authenticated;
GRANT ALL ON public.inbound_wire_accounts TO service_role;
GRANT SELECT ON public.inbound_wire_events TO authenticated;
GRANT ALL ON public.inbound_wire_events TO service_role;

ALTER TABLE public.inbound_wire_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_wire_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read fbo accounts" ON public.inbound_wire_accounts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins read wire events" ON public.inbound_wire_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_iwa_updated BEFORE UPDATE ON public.inbound_wire_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
