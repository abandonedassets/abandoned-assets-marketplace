CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('covenant-engine') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'covenant-engine');

SELECT cron.schedule(
  'covenant-engine',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://asset-weaver-30.lovable.app/api/public/hooks/covenant-engine',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphYm5yZm91d21leWZrcm1lbHhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMzUxNTgsImV4cCI6MjA5NjgxMTE1OH0.r9PFot5_liO3d2K4aa_83kAD4qgq9cByin5LwJu7VTw"}'::jsonb,
    body := '{"source":"pg_cron"}'::jsonb
  );
  $$
);