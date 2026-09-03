-- Reconciliation Watchdog: system_metrics source-of-truth table
CREATE TABLE IF NOT EXISTS public.system_metrics (
  metric_name TEXT PRIMARY KEY,
  metric_value NUMERIC NOT NULL DEFAULT 0,
  metric_count INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_metrics TO authenticated;
GRANT ALL ON public.system_metrics TO service_role;

ALTER TABLE public.system_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_metrics_read_auth"
  ON public.system_metrics FOR SELECT
  TO authenticated
  USING (true);

-- Realtime push for metric changes
ALTER PUBLICATION supabase_realtime ADD TABLE public.system_metrics;

-- Watchdog: recompute pipeline totals from authoritative rows
CREATE OR REPLACE FUNCTION public.refresh_system_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_escrow_total NUMERIC := 0;
  v_escrow_count INT := 0;
  v_cleared_total NUMERIC := 0;
  v_cleared_count INT := 0;
  v_pipeline_total NUMERIC := 0;
  v_pipeline_count INT := 0;
BEGIN
  SELECT COALESCE(SUM(optimized_acquisition_premium),0), COUNT(*)
    INTO v_escrow_total, v_escrow_count
    FROM public.closing_pipeline_items
    WHERE status = 'Locked-Escrow-Pending';

  SELECT COALESCE(SUM(COALESCE(cleared_amount, optimized_acquisition_premium)),0), COUNT(*)
    INTO v_cleared_total, v_cleared_count
    FROM public.closing_pipeline_items
    WHERE status = 'Funds-Cleared' OR cleared_at IS NOT NULL;

  SELECT COALESCE(SUM(optimized_acquisition_premium),0), COUNT(*)
    INTO v_pipeline_total, v_pipeline_count
    FROM public.closing_pipeline_items
    WHERE status NOT IN ('Dead','Rejected','Funds-Cleared');

  INSERT INTO public.system_metrics(metric_name, metric_value, metric_count, computed_at)
  VALUES
    ('fees_in_escrow', v_escrow_total, v_escrow_count, now()),
    ('fees_cleared', v_cleared_total, v_cleared_count, now()),
    ('pipeline_active_fees', v_pipeline_total, v_pipeline_count, now())
  ON CONFLICT (metric_name) DO UPDATE
    SET metric_value = EXCLUDED.metric_value,
        metric_count = EXCLUDED.metric_count,
        computed_at = EXCLUDED.computed_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_system_metrics() TO authenticated, service_role;

-- Seed initial values
SELECT public.refresh_system_metrics();

-- Schedule watchdog every minute
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule('system_metrics_watchdog')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='system_metrics_watchdog');
    PERFORM cron.schedule(
      'system_metrics_watchdog',
      '* * * * *',
      $cron$ SELECT public.refresh_system_metrics(); $cron$
    );
  END IF;
END$$;

-- Refresh metrics whenever a pipeline row changes (instant accuracy between cron ticks)
CREATE OR REPLACE FUNCTION public.trg_refresh_metrics_on_pipeline_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_system_metrics();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_refresh_metrics ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_refresh_metrics
AFTER INSERT OR UPDATE OF status, cleared_at, cleared_amount, optimized_acquisition_premium
OR DELETE ON public.closing_pipeline_items
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_refresh_metrics_on_pipeline_change();