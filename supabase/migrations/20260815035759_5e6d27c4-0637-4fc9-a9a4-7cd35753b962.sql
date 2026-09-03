CREATE OR REPLACE FUNCTION public.enforce_settled_funds()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref text;
BEGIN
  v_ref := COALESCE(NEW.payout_transfer_id, NEW.stripe_session_id, '');

  IF NEW.status IN ('Funds-Cleared','Closed')
     AND COALESCE(OLD.status::text, '') IS DISTINCT FROM NEW.status::text THEN
    IF NEW.cleared_at IS NULL
       OR COALESCE(NEW.cleared_amount, 0) <= 0
       OR v_ref = '' THEN
      RAISE EXCEPTION 'Cannot settle deal %: real assignment fee not confirmed in bank ledger (cleared_at=%, cleared_amount=%, tx_ref=%)',
        NEW.id, NEW.cleared_at, NEW.cleared_amount, NULLIF(v_ref,'');
    END IF;
  END IF;

  IF NEW.contract_state = 'EMD_CLEARED'
     AND COALESCE(OLD.contract_state, '') IS DISTINCT FROM NEW.contract_state THEN
    IF v_ref = '' AND NEW.cleared_at IS NULL THEN
      RAISE EXCEPTION 'Cannot mark contract EMD_CLEARED for deal %: no settled transaction reference', NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_settled_funds ON public.closing_pipeline_items;
CREATE TRIGGER trg_enforce_settled_funds
BEFORE UPDATE ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_settled_funds();