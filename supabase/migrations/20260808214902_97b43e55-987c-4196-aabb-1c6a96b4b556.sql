ALTER TABLE public.buyer_waitlist
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS buyer_tier text NOT NULL DEFAULT 'primary';

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS syndicated_at timestamptz,
  ADD COLUMN IF NOT EXISTS title_ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS title_order_ref text,
  ADD COLUMN IF NOT EXISTS fee_decay_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_tier_stage text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS payout_transfer_id text,
  ADD COLUMN IF NOT EXISTS payout_at timestamptz;

CREATE TABLE IF NOT EXISTS public.outbound_alert_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  channel text NOT NULL,
  target text,
  status text NOT NULL DEFAULT 'sent',
  error text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.outbound_alert_log TO authenticated;
GRANT ALL ON public.outbound_alert_log TO service_role;

ALTER TABLE public.outbound_alert_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read outbound alerts"
  ON public.outbound_alert_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role manages outbound alerts"
  ON public.outbound_alert_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER outbound_alert_log_updated_at
  BEFORE UPDATE ON public.outbound_alert_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS outbound_alert_log_item_idx ON public.outbound_alert_log(pipeline_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cpi_syndication_idx ON public.closing_pipeline_items(status, syndicated_at);