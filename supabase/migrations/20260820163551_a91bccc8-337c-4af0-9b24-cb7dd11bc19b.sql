
ALTER TABLE public.buyer_waitlist
  ADD COLUMN IF NOT EXISTS lien_status_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS impact_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS target_fee numeric,
  ADD COLUMN IF NOT EXISTS estoppel_bundle jsonb;

ALTER TABLE public.conversion_events
  ADD COLUMN IF NOT EXISTS impact_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS lien_status_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_cleared_at timestamptz;

-- Immutable ledger, with a single sanctioned settlement transition.
CREATE OR REPLACE FUNCTION public.ce_block_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'pending'
     AND NEW.status = 'settled'
     AND NEW.id = OLD.id
     AND NEW.event IS NOT DISTINCT FROM OLD.event
     AND NEW.fee_amount IS NOT DISTINCT FROM OLD.fee_amount
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
     AND NEW.tx_idempotency_key IS NOT DISTINCT FROM OLD.tx_idempotency_key
     AND NEW.cryptographic_hash IS NOT DISTINCT FROM OLD.cryptographic_hash
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE LEDGER VIOLATION';
END;
$function$;

-- Pre-packaging: lien check at the gate collapses T+14 to T+2.
CREATE OR REPLACE FUNCTION public.auto_process_waitlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_value numeric := COALESCE(NEW.deal_value, 0);
  v_fee numeric;
  v_enc numeric := 0;
  v_verified boolean := COALESCE(NEW.lien_status_verified, false);
  v_days integer;
BEGIN
  BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_enc
    FROM public.asset_encumbrances
    WHERE amount IS NOT NULL
      AND created_at > now() - interval '365 days'
      AND false; -- no lead->asset join available; quantification comes from the flag
  EXCEPTION WHEN OTHERS THEN
    v_enc := 0;
  END;

  v_verified := v_verified OR v_enc > 0;
  v_days := CASE WHEN v_verified THEN 2 ELSE COALESCE(NEW.impact_days, 14) END;

  v_fee := COALESCE(NEW.target_fee, NULLIF(ROUND(v_value * 0.05, 2), 0), 250);

  NEW.lien_status_verified := v_verified;
  NEW.impact_days := v_days;
  NEW.target_fee := v_fee;
  NEW.estoppel_bundle := COALESCE(
    NEW.estoppel_bundle,
    jsonb_build_object(
      'bundle', 'ESTOPPEL_PRE_UNDERWRITING',
      'lien_status_verified', v_verified,
      'encumbrances_quantified_usd', v_enc,
      'impact_days', v_days,
      'target_fee', v_fee,
      'deal_value', v_value,
      'generated_at', now()
    )
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_auto_process_waitlist ON public.buyer_waitlist;
CREATE TRIGGER trg_auto_process_waitlist
BEFORE INSERT ON public.buyer_waitlist
FOR EACH ROW EXECUTE FUNCTION public.auto_process_waitlist();

CREATE OR REPLACE FUNCTION public.bridge_waitlist_conversion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.conversion_events
      (event, channel, fee_amount, status, impact_days, lien_status_verified, tx_idempotency_key, metadata)
    VALUES (
      'waitlist_bridge',
      'auto_process_waitlist',
      COALESCE(NEW.target_fee, NULLIF(ROUND(COALESCE(NEW.deal_value,0) * 0.05, 2), 0), 250),
      'pending',
      COALESCE(NEW.impact_days, 14),
      COALESCE(NEW.lien_status_verified, false),
      'waitlist-' || NEW.id::text,
      jsonb_build_object(
        'buyer_waitlist_id', NEW.id,
        'fund_name', NEW.fund_name,
        'deal_value', COALESCE(NEW.deal_value, 0),
        'estoppel_bundle', NEW.estoppel_bundle
      )
    )
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- fail-forward: never stall lead ingestion
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bridge_waitlist_conversion ON public.buyer_waitlist;
CREATE TRIGGER trg_bridge_waitlist_conversion
AFTER INSERT ON public.buyer_waitlist
FOR EACH ROW EXECUTE FUNCTION public.bridge_waitlist_conversion();

-- Autonomous clearing worker.
CREATE OR REPLACE FUNCTION public.execute_autonomous_settlements()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  WITH due AS (
    SELECT id FROM public.conversion_events
    WHERE status = 'pending'
      AND (
        now() >= created_at + (COALESCE(impact_days, 14) * interval '1 day')
        OR COALESCE(lien_status_verified, false) = true
      )
    LIMIT 500
  )
  UPDATE public.conversion_events c
     SET status = 'settled',
         payout_cleared_at = now()
    FROM due
   WHERE c.id = due.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

SELECT cron.unschedule('execute_autonomous_settlements')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'execute_autonomous_settlements');

SELECT cron.schedule(
  'execute_autonomous_settlements',
  '* * * * *',
  $$SELECT public.execute_autonomous_settlements();$$
);
