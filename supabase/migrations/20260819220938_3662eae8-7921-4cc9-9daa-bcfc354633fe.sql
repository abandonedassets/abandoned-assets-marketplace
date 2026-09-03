ALTER TABLE public.buyer_waitlist ADD COLUMN IF NOT EXISTS deal_value numeric NOT NULL DEFAULT 0;
ALTER TABLE public.conversion_events ADD COLUMN IF NOT EXISTS fee_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.conversion_events ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
CREATE INDEX IF NOT EXISTS conversion_events_status_created_idx ON public.conversion_events (status, created_at DESC);
CREATE INDEX IF NOT EXISTS buyer_waitlist_stale_idx ON public.buyer_waitlist (is_stale);