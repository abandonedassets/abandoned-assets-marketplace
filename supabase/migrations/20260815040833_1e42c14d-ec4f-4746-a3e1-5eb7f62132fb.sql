CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1. Minute-level unattended cycle worker
SELECT cron.unschedule('autonomous-cycle') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autonomous-cycle');
SELECT cron.schedule(
  'autonomous-cycle',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://asset-weaver-30.lovable.app/api/public/hooks/autonomous-cycle',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphYm5yZm91d21leWZrcm1lbHhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMzUxNTgsImV4cCI6MjA5NjgxMTE1OH0.r9PFot5_liO3d2K4aa_83kAD4qgq9cByin5LwJu7VTw"}'::jsonb,
    body := '{"reason":"cron","mode":"full"}'::jsonb
  );
  $$
);

-- 2. Event-driven dispatch on deal arrival / dispatch-readiness, throttled to 30s
CREATE OR REPLACE FUNCTION public.trg_autonomous_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_fire timestamptz;
BEGIN
  SELECT (value->>'at')::timestamptz INTO last_fire
  FROM public.system_config WHERE key = 'autonomous_trigger_last_fire';

  IF last_fire IS NOT NULL AND last_fire > now() - interval '30 seconds' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.system_config(key, value, updated_at)
  VALUES ('autonomous_trigger_last_fire', jsonb_build_object('at', now()), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  PERFORM net.http_post(
    url := 'https://asset-weaver-30.lovable.app/api/public/hooks/autonomous-cycle',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('reason', 'db_trigger', 'mode', 'delta', 'ids', jsonb_build_array(NEW.id::text))
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_autonomous_dispatch_ins ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_autonomous_dispatch_ins
AFTER INSERT ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.trg_autonomous_dispatch();

DROP TRIGGER IF EXISTS trg_cpi_autonomous_dispatch_upd ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_autonomous_dispatch_upd
AFTER UPDATE OF status ON public.closing_pipeline_items
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('Webhook_Dispatched','In-Escrow','Buyer-Signed'))
EXECUTE FUNCTION public.trg_autonomous_dispatch();