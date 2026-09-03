SELECT cron.unschedule('deadman-switch') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='deadman-switch');
SELECT cron.unschedule('audit-vault-export') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='audit-vault-export');

SELECT cron.schedule('deadman-switch','17 * * * *', $$
  SELECT net.http_post(
    url:='https://project--dd9b0412-ab83-4f6e-86a4-cd1dedd921cc.lovable.app/api/public/hooks/deadman',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:='{}'::jsonb);
$$);

SELECT cron.schedule('audit-vault-export','37 * * * *', $$
  SELECT net.http_post(
    url:='https://project--dd9b0412-ab83-4f6e-86a4-cd1dedd921cc.lovable.app/api/public/hooks/audit-vault',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:='{}'::jsonb);
$$);