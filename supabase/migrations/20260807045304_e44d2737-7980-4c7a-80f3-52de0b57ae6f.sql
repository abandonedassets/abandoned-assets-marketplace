ALTER TABLE public.esign_requests
  ADD COLUMN IF NOT EXISTS ach_reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_ach_reminder_at timestamptz;