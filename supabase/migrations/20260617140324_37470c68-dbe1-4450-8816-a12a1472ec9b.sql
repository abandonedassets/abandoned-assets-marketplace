
ALTER TYPE public.app_pipeline_status ADD VALUE IF NOT EXISTS 'Queued-For-Tomorrow';
ALTER TYPE public.app_pipeline_status ADD VALUE IF NOT EXISTS 'System-Hold';

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS clear_retry_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.cpi_block_owner_sensitive_updates()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR session_user = 'service_role'
     OR session_user = 'postgres' THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.escrow_status IS DISTINCT FROM OLD.escrow_status
     OR NEW.stripe_session_id IS DISTINCT FROM OLD.stripe_session_id
     OR NEW.stripe_session_url IS DISTINCT FROM OLD.stripe_session_url
     OR NEW.stripe_session_expires_at IS DISTINCT FROM OLD.stripe_session_expires_at
     OR NEW.cleared_at IS DISTINCT FROM OLD.cleared_at
     OR NEW.cleared_amount IS DISTINCT FROM OLD.cleared_amount
     OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
     OR NEW.locked_by_key_id IS DISTINCT FROM OLD.locked_by_key_id
     OR NEW.matched_buyer_id IS DISTINCT FROM OLD.matched_buyer_id
     OR NEW.matched_buy_box_id IS DISTINCT FROM OLD.matched_buy_box_id
     OR NEW.spread_multiplier IS DISTINCT FROM OLD.spread_multiplier
     OR NEW.spread_score IS DISTINCT FROM OLD.spread_score
     OR NEW.auto_clearance_ready IS DISTINCT FROM OLD.auto_clearance_ready
     OR NEW.confidence_score IS DISTINCT FROM OLD.confidence_score
     OR NEW.manual_review IS DISTINCT FROM OLD.manual_review
     OR NEW.is_stale IS DISTINCT FROM OLD.is_stale
     OR NEW.stale_at IS DISTINCT FROM OLD.stale_at
     OR NEW.is_held IS DISTINCT FROM OLD.is_held
     OR NEW.held_until IS DISTINCT FROM OLD.held_until
     OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.escrow_doc_path IS DISTINCT FROM OLD.escrow_doc_path
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.external_id IS DISTINCT FROM OLD.external_id
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.sovereign_override IS DISTINCT FROM OLD.sovereign_override
     OR NEW.sovereign_override_at IS DISTINCT FROM OLD.sovereign_override_at
     OR NEW.clear_retry_count IS DISTINCT FROM OLD.clear_retry_count
     OR NEW.requires_legal_review IS DISTINCT FROM OLD.requires_legal_review THEN
    RAISE EXCEPTION 'OWNER_CANNOT_MODIFY_OPERATIONAL_FIELDS'
      USING ERRCODE = '42501',
            HINT = 'Use server-side RPCs to change operational state.';
  END IF;
  RETURN NEW;
END;
$function$;

INSERT INTO public.system_config(key, value)
VALUES ('daily_payout_cap_usd', '5000'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cleared_today_usd()
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(COALESCE(cleared_amount, optimized_acquisition_premium, 0)), 0)::numeric
  FROM public.closing_pipeline_items
  WHERE cleared_at IS NOT NULL
    AND cleared_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
$$;

DROP FUNCTION IF EXISTS public.auto_clear_eligible_deals();

CREATE OR REPLACE FUNCTION public.auto_clear_eligible_deals()
 RETURNS TABLE(deal_id uuid, cleared_amount numeric, zip text, action text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _r RECORD; _amt NUMERIC; _evt TEXT;
  _cap NUMERIC; _cleared_today NUMERIC; _remaining NUMERIC;
BEGIN
  SELECT COALESCE((value)::text::numeric, 5000) INTO _cap
  FROM public.system_config WHERE key = 'daily_payout_cap_usd';
  IF _cap IS NULL THEN _cap := 5000; END IF;

  _cleared_today := public.cleared_today_usd();
  _remaining := GREATEST(_cap - _cleared_today, 0);

  -- First: promote yesterday's rollovers back into the lane (FIFO) so they go first today
  UPDATE public.closing_pipeline_items
     SET status = 'Locked-Escrow-Pending'::app_pipeline_status,
         escrow_status = 'pending_dispatch',
         updated_at = now()
   WHERE status = 'Queued-For-Tomorrow'::app_pipeline_status
     AND updated_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  FOR _r IN
    SELECT id, zip, optimized_acquisition_premium, locked_at, clear_retry_count
    FROM public.closing_pipeline_items
    WHERE status = 'Locked-Escrow-Pending'::app_pipeline_status
      AND COALESCE(manual_review,false) = false
      AND COALESCE(is_stale,false) = false
      AND COALESCE(requires_legal_review,false) = false
      AND COALESCE(confidence_score,0) >= 50
      AND locked_at IS NOT NULL
      AND locked_at < now() - interval '30 seconds'
    ORDER BY locked_at ASC
    LIMIT 10
    FOR UPDATE SKIP LOCKED
  LOOP
    _amt := COALESCE(_r.optimized_acquisition_premium, 0);

    IF _amt > _remaining THEN
      UPDATE public.closing_pipeline_items SET
        status = 'Queued-For-Tomorrow'::app_pipeline_status,
        escrow_status = 'queued_rollover',
        updated_at = now()
      WHERE id = _r.id;
      deal_id := _r.id; cleared_amount := _amt; zip := _r.zip; action := 'queued';
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      _evt := 'auto_clear:' || _r.id::text || ':' || extract(epoch from now())::bigint;
      UPDATE public.closing_pipeline_items SET
        status = 'Funds-Cleared'::app_pipeline_status,
        escrow_status = 'cleared', cleared_at = now(), cleared_amount = _amt,
        lock_expires_at = NULL, is_stale = false,
        clear_retry_count = 0, updated_at = now()
      WHERE id = _r.id;
      INSERT INTO public.processed_ledger_events(event_id) VALUES (_evt) ON CONFLICT DO NOTHING;
      _remaining := _remaining - _amt;
      _cleared_today := _cleared_today + _amt;
      deal_id := _r.id; cleared_amount := _amt; zip := _r.zip; action := 'cleared';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      IF _r.clear_retry_count + 1 >= 3 THEN
        UPDATE public.closing_pipeline_items SET
          status = 'System-Hold'::app_pipeline_status,
          escrow_status = 'dead_letter',
          clear_retry_count = _r.clear_retry_count + 1,
          updated_at = now()
        WHERE id = _r.id;
        INSERT INTO public.system_alerts(severity, kind, message, deal_id, metadata)
        VALUES ('high','dead_letter_clearing',
          'Asset moved to SYSTEM-HOLD after 3 consecutive clearing failures',
          _r.id,
          jsonb_build_object('zip',_r.zip,'amount',_amt,'last_error',SQLERRM));
        deal_id := _r.id; cleared_amount := _amt; zip := _r.zip; action := 'dead_letter';
        RETURN NEXT;
      ELSE
        UPDATE public.closing_pipeline_items SET
          clear_retry_count = _r.clear_retry_count + 1,
          updated_at = now()
        WHERE id = _r.id;
        deal_id := _r.id; cleared_amount := _amt; zip := _r.zip; action := 'retry';
        RETURN NEXT;
      END IF;
    END;
  END LOOP;
END;
$function$;
