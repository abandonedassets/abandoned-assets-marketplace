ALTER TABLE public.buyer_buy_boxes
  ADD COLUMN IF NOT EXISTS target_states text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS min_discount_pct numeric;