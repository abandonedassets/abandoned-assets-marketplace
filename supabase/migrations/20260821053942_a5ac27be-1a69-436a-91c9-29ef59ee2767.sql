ALTER TABLE public.offer_delivery_logs
  ADD COLUMN IF NOT EXISTS recipient_email text,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE INDEX IF NOT EXISTS offer_delivery_logs_provider_msg_idx
  ON public.offer_delivery_logs (provider_message_id);
CREATE INDEX IF NOT EXISTS offer_delivery_logs_created_idx
  ON public.offer_delivery_logs (created_at DESC);