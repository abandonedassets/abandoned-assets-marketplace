CREATE OR REPLACE FUNCTION public.cpi_scout_router()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _score integer := COALESCE(NEW.confidence_score, 0);
BEGIN
  IF NEW.status::text IN (
    'Locked-Escrow-Pending','Funds-Cleared','Closed','Dead',
    'CRITICAL_STALL','System-Hold','Queued-For-Tomorrow'
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'Scout'::app_pipeline_status THEN
    -- Explicit dispatch promotion by the sweep worker (score gate 60)
    IF NEW.status = 'Webhook_Dispatched'::app_pipeline_status AND _score >= 60 THEN
      NEW.manual_review := false;
      NEW.is_held := false;
      RETURN NEW;
    END IF;
    IF _score >= 90 THEN
      NEW.status := 'New'::app_pipeline_status;
      NEW.manual_review := false;
    ELSE
      NEW.status := 'Scout'::app_pipeline_status;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF _score < 60 THEN
      NEW.status := 'Rejected'::app_pipeline_status;
      NEW.is_held := true;
      NEW.manual_review := true;
    ELSIF _score < 90 THEN
      NEW.status := 'Scout'::app_pipeline_status;
      NEW.manual_review := false;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;