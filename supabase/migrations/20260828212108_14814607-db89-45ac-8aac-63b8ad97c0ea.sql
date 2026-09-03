ALTER TABLE public.buyer_buy_boxes
  ADD COLUMN IF NOT EXISTS public_key text,
  ADD COLUMN IF NOT EXISTS verification_tier text NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN IF NOT EXISTS min_deal_size_usd numeric,
  ADD COLUMN IF NOT EXISTS target_cap_rate_min numeric,
  ADD COLUMN IF NOT EXISTS legal_name text;

ALTER TABLE public.buyer_buy_boxes ALTER COLUMN buyer_id SET DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS buyer_buy_boxes_webhook_url_uniq
  ON public.buyer_buy_boxes (webhook_url) WHERE webhook_url IS NOT NULL;