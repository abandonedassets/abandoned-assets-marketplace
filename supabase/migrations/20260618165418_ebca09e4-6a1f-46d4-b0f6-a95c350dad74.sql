CREATE OR REPLACE FUNCTION public.process_scout_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'Scout'::app_pipeline_status
     AND NEW.status = 'Scout'::app_pipeline_status
     AND COALESCE(NEW.confidence_score, 0) >= 90 THEN

    NEW.status := 'New'::app_pipeline_status;
    NEW.manual_review := false;
    NEW.updated_at := now();

    BEGIN
      INSERT INTO public.system_audit_log(table_name, row_id, operation, old_data, new_data, changed_by)
      VALUES (
        'closing_pipeline_items',
        NEW.id,
        'INSTANT_CLOUD_PROMOTION',
        jsonb_build_object('status','Scout','score', OLD.confidence_score),
        jsonb_build_object('status','New','score', NEW.confidence_score),
        NULL
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_instant_scout_processor ON public.closing_pipeline_items;
CREATE TRIGGER trg_instant_scout_processor
BEFORE UPDATE ON public.closing_pipeline_items
FOR EACH ROW
EXECUTE FUNCTION public.process_scout_mutation();