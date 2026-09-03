
-- 1. Extend owner-sensitive guard to INSERT: force operational fields to safe defaults
CREATE OR REPLACE FUNCTION public.cpi_block_owner_sensitive_updates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Service-role / postgres bypass entirely
  IF current_setting('role', true) = 'service_role'
     OR session_user IN ('service_role','postgres') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Force ownership and strip operational fields on owner-side inserts
    NEW.user_id := auth.uid();
    NEW.status := 'New'::app_pipeline_status;
    NEW.escrow_status := NULL;
    NEW.stripe_session_id := NULL;
    NEW.stripe_session_url := NULL;
    NEW.stripe_session_expires_at := NULL;
    NEW.cleared_at := NULL;
    NEW.cleared_amount := NULL;
    NEW.locked_at := NULL;
    NEW.locked_by_key_id := NULL;
    NEW.lock_expires_at := NULL;
    NEW.escrow_pending_at := NULL;
    NEW.matched_buyer_id := NULL;
    NEW.matched_buy_box_id := NULL;
    NEW.spread_multiplier := 1.0;
    NEW.spread_score := NULL;
    NEW.auto_clearance_ready := false;
    NEW.manual_review := false;
    NEW.is_stale := false;
    NEW.stale_at := NULL;
    NEW.is_held := false;
    NEW.held_until := NULL;
    NEW.bundle_id := NULL;
    NEW.sovereign_override := false;
    NEW.sovereign_override_at := NULL;
    NEW.clear_retry_count := 0;
    NEW.requires_legal_review := false;
    NEW.seller_routing_json := NULL;
    NEW.virtual_funding_credit := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE path (unchanged)
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.escrow_status IS DISTINCT FROM OLD.escrow_status
     OR NEW.stripe_session_id IS DISTINCT FROM OLD.stripe_session_id
     OR NEW.stripe_session_url IS DISTINCT FROM OLD.stripe_session_url
     OR NEW.stripe_session_expires_at IS DISTINCT FROM OLD.stripe_session_expires_at
     OR NEW.cleared_at IS DISTINCT FROM OLD.cleared_at
     OR NEW.cleared_amount IS DISTINCT FROM OLD.cleared_amount
     OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
     OR NEW.locked_by_key_id IS DISTINCT FROM OLD.locked_by_key_id
     OR NEW.escrow_pending_at IS DISTINCT FROM OLD.escrow_pending_at
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
     OR NEW.seller_routing_json IS DISTINCT FROM OLD.seller_routing_json
     OR NEW.virtual_funding_credit IS DISTINCT FROM OLD.virtual_funding_credit
     OR NEW.requires_legal_review IS DISTINCT FROM OLD.requires_legal_review THEN
    RAISE EXCEPTION 'OWNER_CANNOT_MODIFY_OPERATIONAL_FIELDS'
      USING ERRCODE = '42501',
            HINT = 'Use server-side RPCs to change operational state.';
  END IF;
  RETURN NEW;
END;
$$;

-- Ensure trigger fires for INSERT too
DROP TRIGGER IF EXISTS trg_cpi_block_owner_sensitive_updates ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_block_owner_sensitive_updates
  BEFORE INSERT OR UPDATE ON public.closing_pipeline_items
  FOR EACH ROW
  EXECUTE FUNCTION public.cpi_block_owner_sensitive_updates();

-- 2. Drop the overly broad realtime policy; rely on topic-scoped policy
DROP POLICY IF EXISTS "Authenticated users can receive own pipeline broadcasts" ON realtime.messages;
