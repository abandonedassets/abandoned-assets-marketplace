
-- 1. Add sovereign override columns
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS sovereign_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sovereign_override_at TIMESTAMPTZ;

-- 2. Protect sovereign_override from owner edits (only service_role can toggle)
CREATE OR REPLACE FUNCTION public.cpi_block_owner_sensitive_updates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR session_user = 'service_role'
     OR session_user = 'postgres' THEN
    RETURN NEW;
  END IF;

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
     OR NEW.requires_legal_review IS DISTINCT FROM OLD.requires_legal_review THEN
    RAISE EXCEPTION 'OWNER_CANNOT_MODIFY_OPERATIONAL_FIELDS'
      USING ERRCODE = '42501',
            HINT = 'Use server-side RPCs to change operational state.';
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Update title-hardening trigger to honor sovereign_override
CREATE OR REPLACE FUNCTION public.enforce_title_hardening()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _hay text; _has_risk boolean;
BEGIN
  _hay := lower(coalesce(NEW.title_notes,'') || ' ' || coalesce(NEW.address,''));
  _has_risk := (NEW.title_status = 'Uninsurable'
                OR _hay ~ '(quitclaim|quit-claim|quit claim|uninsurable)');

  IF _has_risk THEN
    IF NEW.title_status IS DISTINCT FROM 'Uninsurable' THEN
      NEW.title_status := 'Uninsurable';
    END IF;

    IF COALESCE(NEW.sovereign_override, false) = true THEN
      -- Sovereign authorized bypass: clear the block, log the intent
      NEW.requires_legal_review := false;
      INSERT INTO public.system_alerts(severity, kind, message, deal_id, metadata)
      VALUES ('high','sovereign_override_bypass',
        'Sovereign override active — legal-hold bypass authorized for asset',
        NEW.id,
        jsonb_build_object('address',NEW.address,'zip',NEW.zip,
                           'title_status',NEW.title_status,'title_notes',NEW.title_notes));
    ELSE
      NEW.requires_legal_review := true;
      IF NEW.status::text IN ('Locked-Escrow-Pending','Funds-Cleared') THEN
        RAISE EXCEPTION 'LEGAL_HOLD_BLOCK: asset requires title curative review or sovereign override before settlement'
          USING ERRCODE = 'P0001';
      END IF;
      NEW.escrow_status := 'LEGAL-HOLD';
      NEW.is_held := true;
      NEW.bundle_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 4. Enhance legal-hold alerts: include detected risk markers summary
CREATE OR REPLACE FUNCTION public.alert_legal_hold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _hay text;
  _markers text[] := ARRAY[]::text[];
  _summary text;
BEGIN
  IF NEW.requires_legal_review = true
     AND (TG_OP = 'INSERT' OR OLD.requires_legal_review IS DISTINCT FROM true) THEN

    _hay := lower(coalesce(NEW.title_notes,'') || ' ' || coalesce(NEW.address,''));
    IF NEW.title_status = 'Uninsurable' THEN _markers := array_append(_markers,'uninsurable_title'); END IF;
    IF _hay ~ '(quitclaim|quit-claim|quit claim)' THEN _markers := array_append(_markers,'quitclaim_deed'); END IF;
    IF _hay ~ 'uninsurable' THEN _markers := array_append(_markers,'uninsurable_keyword'); END IF;
    IF _hay ~ '(lien|encumbrance|tax sale|foreclosure)' THEN _markers := array_append(_markers,'encumbrance_keyword'); END IF;

    _summary := CASE
      WHEN array_length(_markers,1) IS NULL THEN 'Title risk detected'
      ELSE 'Title risk detected: ' || array_to_string(_markers, ', ')
    END;

    INSERT INTO public.system_alerts(severity, kind, message, deal_id, metadata)
    VALUES ('high','legal_hold',
      _summary || ' — asset routed to LEGAL-HOLD. Toggle sovereign_override to authorize bypass.',
      NEW.id,
      jsonb_build_object(
        'address',NEW.address,
        'zip',NEW.zip,
        'title_status',NEW.title_status,
        'title_notes',NEW.title_notes,
        'risk_markers',_markers,
        'override_available', true,
        'priority','top'
      ));
  END IF;
  RETURN NEW;
END;
$function$;
