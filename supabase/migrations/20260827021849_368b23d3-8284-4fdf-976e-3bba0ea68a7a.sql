CREATE OR REPLACE FUNCTION public.handle_autonomous_settlement_alert()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.stripe_session_id IS NOT NULL AND OLD.stripe_session_id IS NULL)
     OR (NEW.cleared_at IS NOT NULL AND OLD.cleared_at IS NULL)
     OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('Funds-Cleared','Closed')) THEN
    INSERT INTO public.outbound_alert_log (pipeline_item_id, alert_type, payload, created_at)
    VALUES (
      NEW.id,
      'TRANSACTION_SETTLED_SUCCESS',
      jsonb_build_object(
        'event', 'TRANSACTION_SETTLED_SUCCESS',
        'asset_id', NEW.id,
        'amount', NEW.optimized_acquisition_premium,
        'property_address', NEW.property_address,
        'zip', NEW.zip,
        'stripe_ref', NEW.stripe_session_id,
        'status', NEW.status,
        'timestamp', NOW()
      ),
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trig_autonomous_settlement_alert ON public.closing_pipeline_items;
CREATE TRIGGER trig_autonomous_settlement_alert
  AFTER UPDATE ON public.closing_pipeline_items
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_autonomous_settlement_alert();