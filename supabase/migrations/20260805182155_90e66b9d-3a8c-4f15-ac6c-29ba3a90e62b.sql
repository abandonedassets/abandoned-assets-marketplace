SELECT cron.unschedule('tif-shadow-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tif-shadow-sweep');

SELECT cron.schedule(
  'tif-shadow-sweep',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--dd9b0412-ab83-4f6e-86a4-cd1dedd921cc.lovable.app/api/public/hooks/tif-shadow-sweep',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);