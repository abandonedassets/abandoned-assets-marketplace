ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_session_url TEXT,
  ADD COLUMN IF NOT EXISTS stripe_session_expires_at TIMESTAMPTZ;