
SELECT cron.schedule(
  'dlq-auto-retry',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://asset-weaver-30.lovable.app/api/public/hooks/dlq-retry',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphYm5yZm91d21leWZrcm1lbHhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMzUxNTgsImV4cCI6MjA5NjgxMTE1OH0.r9PFot5_liO3d2K4aa_83kAD4qgq9cByin5LwJu7VTw"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
