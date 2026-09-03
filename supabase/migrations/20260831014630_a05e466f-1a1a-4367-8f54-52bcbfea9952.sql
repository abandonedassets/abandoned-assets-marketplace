CREATE TABLE public.institutional_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  endpoint_url text NOT NULL,
  api_key_hash text,
  outbound_api_key text,
  auth_header text NOT NULL DEFAULT 'Authorization',
  min_deal_size_usd numeric DEFAULT 0,
  max_deal_size_usd numeric DEFAULT 100000000,
  target_asset_classes text[] DEFAULT '{}'::text[],
  active boolean NOT NULL DEFAULT true,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_dispatch_at timestamptz,
  last_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.institutional_webhooks TO authenticated;
GRANT ALL ON public.institutional_webhooks TO service_role;
ALTER TABLE public.institutional_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage institutional webhooks" ON public.institutional_webhooks
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.m2m_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  webhook_id uuid REFERENCES public.institutional_webhooks(id) ON DELETE SET NULL,
  buyer_label text,
  bid_amount numeric NOT NULL DEFAULT 0,
  required_threshold numeric,
  payment_intent text,
  status text NOT NULL DEFAULT 'RECEIVED',
  reason text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.m2m_bids TO authenticated;
GRANT ALL ON public.m2m_bids TO service_role;
ALTER TABLE public.m2m_bids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read m2m bids" ON public.m2m_bids
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_m2m_bids_item ON public.m2m_bids(pipeline_item_id, created_at DESC);
CREATE UNIQUE INDEX idx_institutional_webhooks_url ON public.institutional_webhooks(endpoint_url);

CREATE TRIGGER trg_institutional_webhooks_updated BEFORE UPDATE ON public.institutional_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_m2m_bids_updated BEFORE UPDATE ON public.m2m_bids
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();