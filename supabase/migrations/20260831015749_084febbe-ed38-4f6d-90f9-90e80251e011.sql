CREATE TABLE public.dispersed_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid NOT NULL,
  webhook_id uuid,
  api_key_hash text,
  base_price numeric NOT NULL DEFAULT 0,
  markup_pct numeric NOT NULL DEFAULT 0,
  quoted_price numeric NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.dispersed_quotes TO service_role;
ALTER TABLE public.dispersed_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read dispersed quotes" ON public.dispersed_quotes
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_dispersed_quotes_item ON public.dispersed_quotes (pipeline_item_id, api_key_hash);

CREATE TRIGGER trg_dispersed_quotes_updated
  BEFORE UPDATE ON public.dispersed_quotes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.institutional_webhooks ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'HEALTHY';
ALTER TABLE public.m2m_bids ADD COLUMN IF NOT EXISTS auction_window_id text;
ALTER TABLE public.m2m_bids ADD COLUMN IF NOT EXISTS quoted_price numeric;