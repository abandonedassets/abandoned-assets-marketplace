ALTER TABLE public.buyer_waitlist
  ADD COLUMN IF NOT EXISTS trading_desk_webhook text,
  ADD COLUMN IF NOT EXISTS tarpit_until timestamptz,
  ADD COLUMN IF NOT EXISTS tarpit_strikes integer NOT NULL DEFAULT 0;

ALTER TABLE public.buyer_buy_boxes
  ADD COLUMN IF NOT EXISTS trading_desk_webhook text;

ALTER TABLE public.institutional_webhooks
  ADD COLUMN IF NOT EXISTS trading_desk_webhook text;

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS checkout_recovery_email_id text,
  ADD COLUMN IF NOT EXISTS checkout_recovery_email_to text;

CREATE INDEX IF NOT EXISTS idx_cpi_recovery_email_id
  ON public.closing_pipeline_items (checkout_recovery_email_id)
  WHERE checkout_recovery_email_id IS NOT NULL;