DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN ('tif-shadow-sweep','process-tif-expirations','execute_autonomous_settlements','autonomous-cycle','system_metrics_watchdog') LOOP
    PERFORM cron.alter_job(r.jobid, '*/5 * * * *');
  END LOOP;
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN ('self-heal-watchdog','self-heal-keepalive','autopilot-watchdog','dlq-zip-recovery','tif-lock-sweep') LOOP
    PERFORM cron.alter_job(r.jobid, '*/15 * * * *');
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_cpi_updated_at_desc ON public.closing_pipeline_items (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cpi_manual_review ON public.closing_pipeline_items (manual_review) WHERE manual_review = true;

ANALYZE public.closing_pipeline_items;