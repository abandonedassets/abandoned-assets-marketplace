
-- 1. Extend status enum with Scout + Rejected lanes
ALTER TYPE public.app_pipeline_status ADD VALUE IF NOT EXISTS 'Scout';
ALTER TYPE public.app_pipeline_status ADD VALUE IF NOT EXISTS 'Rejected';

COMMIT;

-- 2. Scout router: confidence-tiered ingestion classification
CREATE OR REPLACE FUNCTION public.cpi_scout_router()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _score integer := COALESCE(NEW.confidence_score, 0);
BEGIN
  -- Never reclassify locked/cleared/closed lanes
  IF NEW.status::text IN (
    'Locked-Escrow-Pending','Funds-Cleared','Closed','Dead',
    'CRITICAL_STALL','System-Hold','Queued-For-Tomorrow'
  ) THEN
    RETURN NEW;
  END IF;

  -- Never demote an existing Scout row on update — it persists until
  -- promoted by sweep or manually archived.
  IF TG_OP = 'UPDATE' AND OLD.status = 'Scout'::app_pipeline_status THEN
    -- Allow auto-promotion when score recovers
    IF _score >= 90 THEN
      NEW.status := 'New'::app_pipeline_status;
      NEW.manual_review := false;
    ELSE
      NEW.status := 'Scout'::app_pipeline_status;
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT-time routing (and UPDATE re-routing for non-Scout rows)
  IF TG_OP = 'INSERT' THEN
    IF _score < 70 THEN
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

DROP TRIGGER IF EXISTS trg_cpi_scout_router ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_scout_router
  BEFORE INSERT OR UPDATE OF confidence_score, status
  ON public.closing_pipeline_items
  FOR EACH ROW
  EXECUTE FUNCTION public.cpi_scout_router();

-- 3. Shield Scout rows from the exception-queue router
CREATE OR REPLACE FUNCTION public.cpi_route_to_exception_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _threshold integer;
BEGIN
  SELECT COALESCE((value)::text::integer, 95) INTO _threshold
  FROM public.system_config WHERE key = 'exception_queue_threshold';
  IF _threshold IS NULL THEN _threshold := 95; END IF;

  -- Scout, Rejected, and terminal lanes are protected from re-queueing
  IF NEW.status::text IN (
    'Funds-Cleared','Closed','Dead','CRITICAL_STALL',
    'Locked-Escrow-Pending','Scout','Rejected'
  ) THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.confidence_score, 0) < _threshold THEN
    INSERT INTO public.exception_queue(pipeline_item_id, zip, base_contract_price, confidence_score)
    VALUES (NEW.id, NEW.zip, NEW.base_contract_price, NEW.confidence_score)
    ON CONFLICT (pipeline_item_id) DO UPDATE SET
      confidence_score = EXCLUDED.confidence_score,
      base_contract_price = EXCLUDED.base_contract_price,
      zip = EXCLUDED.zip,
      updated_at = now();
  ELSIF NEW.confidence_score >= _threshold THEN
    UPDATE public.exception_queue
       SET resolved_at = now(), resolution = 'promoted', updated_at = now()
     WHERE pipeline_item_id = NEW.id AND resolved_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Scout intelligence sweep: refresh confidence, promote when ready
CREATE OR REPLACE FUNCTION public.promote_scout_deals()
RETURNS TABLE(deal_id uuid, old_score integer, new_score integer, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r RECORD;
  _new_score integer;
BEGIN
  FOR _r IN
    SELECT id, zip, base_contract_price, confidence_score
    FROM public.closing_pipeline_items
    WHERE status = 'Scout'::app_pipeline_status
    ORDER BY updated_at ASC
    LIMIT 500
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      _new_score := public.compute_confidence_score(_r.zip, _r.base_contract_price);

      IF _new_score >= 90 THEN
        UPDATE public.closing_pipeline_items
           SET confidence_score = _new_score,
               status = 'New'::app_pipeline_status,
               manual_review = false,
               updated_at = now()
         WHERE id = _r.id;
        deal_id := _r.id; old_score := _r.confidence_score; new_score := _new_score; action := 'promoted';
        RETURN NEXT;
      ELSIF _new_score < 70 THEN
        -- Market data has further degraded — drop to Rejected
        UPDATE public.closing_pipeline_items
           SET confidence_score = _new_score,
               status = 'Rejected'::app_pipeline_status,
               is_held = true,
               manual_review = true,
               updated_at = now()
         WHERE id = _r.id;
        deal_id := _r.id; old_score := _r.confidence_score; new_score := _new_score; action := 'rejected';
        RETURN NEXT;
      ELSIF _new_score <> COALESCE(_r.confidence_score, 0) THEN
        UPDATE public.closing_pipeline_items
           SET confidence_score = _new_score, updated_at = now()
         WHERE id = _r.id;
        deal_id := _r.id; old_score := _r.confidence_score; new_score := _new_score; action := 'refreshed';
        RETURN NEXT;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.system_alerts(severity, kind, message, deal_id, metadata)
      VALUES ('low','scout_sweep_error', SQLERRM, _r.id,
        jsonb_build_object('sqlstate', SQLSTATE));
    END;
  END LOOP;
END;
$$;

-- 5. Schedule Scout sweep every 24h (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('scout-protocol-sweep')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scout-protocol-sweep');
    PERFORM cron.schedule(
      'scout-protocol-sweep',
      '17 */6 * * *',
      $cron$ SELECT public.promote_scout_deals(); $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
