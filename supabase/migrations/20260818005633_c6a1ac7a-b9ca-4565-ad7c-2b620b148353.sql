-- 1) format() in Postgres does not support "%.2f" — this raised
--    'unrecognized format() type specifier "."' on EVERY status transition
--    that reached the Tier-1 parity check, blocking the underwriter.
CREATE OR REPLACE FUNCTION public.adversarial_audit_cpi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_reason text;
  v_allowed boolean := true;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Pending-Underwriting'
     AND OLD.status NOT IN ('Funds-Cleared','Closed') THEN
    v_allowed := true;
  ELSIF OLD.status = 'Pending-Underwriting' THEN
    v_allowed := true;
  ELSIF OLD.status = 'Rejected' AND NEW.status IN ('Scout','Auto-Enrichment-Pending','New') THEN
    v_allowed := true;
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
    v_reason := format('Parity: Tier-1 fee (%s) must route to Master, got %s',
                       to_char(NEW.optimized_acquisition_premium, 'FM999999999.00'),
                       NEW.active_owner);
  END IF;

  IF NOT v_allowed THEN
    INSERT INTO public.system_audit_logs
      (pipeline_item_id, from_status, to_status, reason, payload)
    VALUES
      (OLD.id, OLD.status, NEW.status, v_reason,
       jsonb_build_object('cleared_amount', NEW.cleared_amount, 'active_owner', NEW.active_owner, 'fee', NEW.optimized_acquisition_premium));

    INSERT INTO public.system_alerts (kind, severity, message, metadata)
    VALUES ('ADVERSARIAL_AUDIT_REJECT', 'high',
            format('Adversarial Audit Failed: %s', v_reason),
            jsonb_build_object('item_id', OLD.id, 'from', OLD.status, 'to', NEW.status));

    RAISE EXCEPTION 'Adversarial Audit Failed: %', v_reason USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

-- 2) Collision-proof asset fingerprint. Two look-alike parcels previously
--    produced the same hash and the unique index blocked the second row's
--    update entirely (zero-friction violation).
CREATE OR REPLACE FUNCTION public.cpi_stamp_m2m_fidelity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  s numeric := 0.5;
  h text;
BEGIN
  IF NEW.apn IS NOT NULL AND length(NEW.apn) > 3 THEN s := s + 0.25; END IF;
  IF NEW.has_signed_marketing_auth THEN s := s + 0.2; END IF;
  IF NEW.owner_entity IS NOT NULL THEN s := s + 0.05; END IF;
  IF NEW.assessed_value IS NOT NULL AND NEW.assessed_value > 0 THEN s := s + 0.05; END IF;
  IF NEW.title_status = 'Insured'::title_status_enum THEN s := s + 0.05; END IF;
  IF NEW.source = 'manual' THEN s := s - 0.1; END IF;
  NEW.data_fidelity_score := LEAST(1.00, GREATEST(0.00, round(s, 2)));

  h := encode(extensions.digest(
    coalesce(NEW.apn, coalesce(NEW.address,'') || '|' || coalesce(NEW.zip,'')) || '|' ||
    coalesce(NEW.base_contract_price, 0)::text || '|' ||
    coalesce(NEW.has_signed_marketing_auth, false)::text, 'sha256'), 'hex');

  IF EXISTS (
    SELECT 1 FROM public.closing_pipeline_items c
    WHERE c.m2m_asset_hash = h AND c.cleared_at IS NULL AND c.id <> NEW.id
  ) THEN
    h := encode(extensions.digest(h || '|' || NEW.id::text, 'sha256'), 'hex');
  END IF;

  NEW.m2m_asset_hash := h;
  RETURN NEW;
END;
$fn$;