SELECT cron.unschedule('shadow-reconcile') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'shadow-reconcile');
SELECT cron.schedule(
  'shadow-reconcile',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--dd9b0412-ab83-4f6e-86a4-cd1dedd921cc.lovable.app/api/public/cron/shadow-reconcile',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphYm5yZm91d21leWZrcm1lbHhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMzUxNTgsImV4cCI6MjA5NjgxMTE1OH0.r9PFot5_liO3d2K4aa_83kAD4qgq9cByin5LwJu7VTw"}'::jsonb,
    body := '{"source":"pg_cron"}'::jsonb
  );
  $$
);