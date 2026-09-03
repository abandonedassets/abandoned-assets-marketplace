ALTER TABLE public.fee_escrow_locks
  ADD COLUMN IF NOT EXISTS swept_at timestamptz,
  ADD COLUMN IF NOT EXISTS capital_token_hash text,
  ADD COLUMN IF NOT EXISTS clearing_network text;

CREATE INDEX IF NOT EXISTS idx_fee_locks_unswept
  ON public.fee_escrow_locks (lock_state) WHERE swept_at IS NULL;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('cold-storage-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cold-storage-sweep');

SELECT cron.schedule(
  'cold-storage-sweep',
  '0 */12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--dd9b0412-ab83-4f6e-86a4-cd1dedd921cc.lovable.app/api/public/cron/cold-sweep',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphYm5yZm91d21leWZrcm1lbHhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMzUxNTgsImV4cCI6MjA5NjgxMTE1OH0.r9PFot5_liO3d2K4aa_83kAD4qgq9cByin5LwJu7VTw"}'::jsonb,
    body := '{"source":"pg_cron"}'::jsonb
  );
  $$
);