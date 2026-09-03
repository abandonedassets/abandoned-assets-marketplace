CREATE OR REPLACE FUNCTION public.auto_process_waitlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value numeric := COALESCE(NEW.deal_value, 0);
  v_fee numeric;
BEGIN
  BEGIN
    v_fee := public.calculate_pipeline_fee(v_value);
  EXCEPTION WHEN OTHERS THEN
    v_fee := NULL;
  END;

  IF v_fee IS NULL OR v_fee <= 0 THEN
    v_fee := GREATEST(ROUND(v_value * 0.03, 2), 250);
  END IF;

  BEGIN
    INSERT INTO public.conversion_events (event, channel, fee_amount, status, tx_idempotency_key, metadata)
    VALUES (
      'waitlist_bridge',
      'auto_process_waitlist',
      v_fee,
      'pending',
      'waitlist-' || NEW.id::text,
      jsonb_build_object('buyer_waitlist_id', NEW.id, 'fund_name', NEW.fund_name, 'deal_value', v_value)
    )
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- fail-forward: never block lead ingestion
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_process_waitlist ON public.buyer_waitlist;
CREATE TRIGGER trg_auto_process_waitlist
AFTER INSERT ON public.buyer_waitlist
FOR EACH ROW EXECUTE FUNCTION public.auto_process_waitlist();

REVOKE EXECUTE ON FUNCTION public.auto_process_waitlist() FROM PUBLIC, anon, authenticated;