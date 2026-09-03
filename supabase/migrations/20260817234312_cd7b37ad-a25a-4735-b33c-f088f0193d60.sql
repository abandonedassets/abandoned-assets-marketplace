CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('ledger-anomaly-scan') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ledger-anomaly-scan');

SELECT cron.schedule(
  'ledger-anomaly-scan',
  '7 * * * *',
  $$ SELECT public.scan_ledger_anomalies(); $$
);