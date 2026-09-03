CREATE OR REPLACE FUNCTION public.handle_autonomous_settlement_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.stripe_session_id IS NOT NULL AND OLD.stripe_session_id IS NULL)
     OR (NEW.cleared_at IS NOT NULL AND OLD.cleared_at IS NULL)
     OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('Funds-Cleared','Closed')) THEN
    BEGIN
      INSERT INTO public.outbound_alert_log (pipeline_item_id, alert_type, payload, created_at)
      VALUES (
        NEW.id,
        'TRANSACTION_SETTLED_SUCCESS',
        jsonb_build_object(
          'event', 'TRANSACTION_SETTLED_SUCCESS',
          'asset_id', NEW.id,
          'amount', NEW.optimized_acquisition_premium,
          'property_address', COALESCE(NEW.address, NEW.zip),
          'zip', NEW.zip,
          'stripe_ref', NEW.stripe_session_id,
          'status', NEW.status,
          'timestamp', NOW()
        ),
        NOW()
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'settlement alert log failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;