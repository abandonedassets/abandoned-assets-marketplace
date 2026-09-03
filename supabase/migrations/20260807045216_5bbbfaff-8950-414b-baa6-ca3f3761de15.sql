CREATE OR REPLACE FUNCTION public.adversarial_audit_cpi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_reason text;
  v_allowed boolean := true;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'Rejected' AND NEW.status IN ('Scout','Auto-Enrichment-Pending','New') THEN
    v_allowed := true; -- re-queue lane: zero-friction resuscitation
  ELSIF OLD.status IN ('Funds-Cleared','Rejected','Dead') THEN
    v_allowed := false;
    v_reason := format('Terminal status %s cannot transition', OLD.status);
  ELSIF OLD.status = 'Scout' AND NEW.status NOT IN ('New','Rejected','Dead','Webhook_Dispatched') THEN
    v_allowed := false;
    v_reason := format('Invalid transition Scout -> %s', NEW.status);
  ELSIF OLD.status = 'New' AND NEW.status NOT IN ('Locked-Escrow-Pending','House-Bid','Buyer-Signed','Rejected','Dead','Funds-Cleared','Webhook_Dispatched') THEN
    v_allowed := false;
    v_reason := format('Invalid transition New -> %s', NEW.status);
  ELSIF OLD.status = 'Buyer-Signed' AND NEW.status NOT IN ('Locked-Escrow-Pending','Funds-Cleared','Dead','Rejected') THEN
    v_allowed := false;
    v_reason := format('Invalid transition Buyer-Signed -> %s', NEW.status);
  ELSIF OLD.status = 'Locked-Escrow-Pending' AND NEW.status NOT IN ('Funds-Cleared','Rejected','Dead') THEN
    v_allowed := false;
    v_reason := format('Invalid transition Locked-Escrow-Pending -> %s', NEW.status);
  ELSIF OLD.status = 'House-Bid' AND NEW.status NOT IN ('New','Locked-Escrow-Pending','Rejected','Dead','Webhook_Dispatched') THEN
    v_allowed := false;
    v_reason := format('Invalid transition House-Bid -> %s', NEW.status);
  ELSIF OLD.status = 'Webhook_Dispatched' AND NEW.status NOT IN ('Locked-Escrow-Pending','Buyer-Signed','New','Rejected','Dead','Shadow_Inventory') THEN
    v_allowed := false;
    v_reason := format('Invalid transition Webhook_Dispatched -> %s', NEW.status);
  END IF;

  IF v_allowed AND NEW.status = 'Funds-Cleared' THEN
    IF COALESCE(NEW.cleared_amount, 0) <= 0 THEN
      v_allowed := false;
      v_reason := 'Integrity: cleared_amount must be > 0 on Funds-Cleared';
    ELSIF NEW.active_owner IS NULL THEN
      v_allowed := false;
      v_reason := 'Parity: active_owner not assigned at clearance';
    END IF;
  END IF;

  IF v_allowed
     AND COALESCE(NEW.optimized_acquisition_premium, 0) >= 100000
     AND NEW.active_owner IS NOT NULL
     AND NEW.active_owner <> 'Master' THEN
    v_allowed := false;
    v_reason := format('Parity: Tier-1 fee (%.2f) must route to Master, got %s',
                       NEW.optimized_acquisition_premium, NEW.active_owner);
  END IF;

  IF NOT v_allowed THEN
    INSERT INTO public.system_audit_logs
      (pipeline_item_id, from_status, to_status, reason, payload)
    VALUES
      (OLD.id, OLD.status, NEW.status, v_reason,
       jsonb_build_object(
         'cleared_amount', NEW.cleared_amount,
         'active_owner', NEW.active_owner,
         'fee', NEW.optimized_acquisition_premium
       ));

    INSERT INTO public.system_alerts (kind, severity, message, metadata)
    VALUES ('ADVERSARIAL_AUDIT_REJECT', 'high',
            format('Adversarial Audit Failed: %s', v_reason),
            jsonb_build_object('item_id', OLD.id, 'from', OLD.status, 'to', NEW.status));

    RAISE EXCEPTION 'Adversarial Audit Failed: %', v_reason
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;