ALTER TABLE public.buyer_buy_boxes
  ADD COLUMN IF NOT EXISTS endpoint_status text NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN IF NOT EXISTS endpoint_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS endpoint_last_code integer;

CREATE INDEX IF NOT EXISTS idx_bbb_endpoint_status ON public.buyer_buy_boxes (endpoint_status);