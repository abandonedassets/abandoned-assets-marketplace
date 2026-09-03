-- P0-B: Replace PARTIAL unique indexes with full unique indexes so
-- `INSERT ... ON CONFLICT (external_id)` and `ON CONFLICT (zip, address)`
-- can resolve them (PostgREST cannot target partial indexes).
DROP INDEX IF EXISTS public.closing_pipeline_items_external_id_uniq;
DROP INDEX IF EXISTS public.closing_pipeline_items_zip_address_uniq;

CREATE UNIQUE INDEX closing_pipeline_items_external_id_uniq
  ON public.closing_pipeline_items (external_id);

CREATE UNIQUE INDEX closing_pipeline_items_zip_address_uniq
  ON public.closing_pipeline_items (zip, lower(address));

-- P1: DLQ anomaly alerting — every DLQ insert raises a system_alert.
CREATE OR REPLACE FUNCTION public.dlq_emit_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.system_alerts(severity, kind, message, metadata)
    VALUES (
      'high',
      'dlq_anomaly',
      COALESCE(NEW.error_reason, 'unknown_dlq_error'),
      jsonb_build_object(
        'source_ip', NEW.source_ip,
        'dlq_id',    NEW.id,
        'created_at', NEW.created_at,
        'raw_payload_keys',
          CASE WHEN jsonb_typeof(NEW.raw_payload) = 'object'
               THEN (SELECT jsonb_agg(k) FROM jsonb_object_keys(NEW.raw_payload) k)
               ELSE NULL END
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- fail-forward: never block ingest because alerting hiccupped
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dlq_emit_alert ON public.dead_letter_queue;
CREATE TRIGGER trg_dlq_emit_alert
AFTER INSERT ON public.dead_letter_queue
FOR EACH ROW EXECUTE FUNCTION public.dlq_emit_alert();
