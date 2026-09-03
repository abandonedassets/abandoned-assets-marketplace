CREATE OR REPLACE FUNCTION public.cpi_block_owner_sensitive_updates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR session_user IN ('service_role','postgres')
     OR (auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin')) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
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
    NEW.title_status := NULL;
    NEW.absolute_floor_price := NULL;
    NEW.payout_transfer_id := NULL;
    NEW.payout_at := NULL;
    NEW.emd_amount := NULL;
    NEW.emd_tier := NULL;
    NEW.priority_override := false;
    NEW.liquidity_tier := NULL;
    NEW.target_vault := NULL;
    NEW.partner_share := NULL;
    NEW.active_owner := NULL;
    NEW.has_signed_marketing_auth := false;
    NEW.marketing_auth_signed_at := NULL;
    NEW.is_fee_positive := false;
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
     OR NEW.requires_legal_review IS DISTINCT FROM OLD.requires_legal_review
     OR NEW.title_status IS DISTINCT FROM OLD.title_status
     OR NEW.title_notes IS DISTINCT FROM OLD.title_notes
     OR NEW.contract_state IS DISTINCT FROM OLD.contract_state
     OR NEW.absolute_floor_price IS DISTINCT FROM OLD.absolute_floor_price
     OR NEW.optimized_acquisition_premium IS DISTINCT FROM OLD.optimized_acquisition_premium
     OR NEW.emd_amount IS DISTINCT FROM OLD.emd_amount
     OR NEW.emd_tier IS DISTINCT FROM OLD.emd_tier
     OR NEW.payout_transfer_id IS DISTINCT FROM OLD.payout_transfer_id
     OR NEW.payout_at IS DISTINCT FROM OLD.payout_at
     OR NEW.priority_override IS DISTINCT FROM OLD.priority_override
     OR NEW.liquidity_tier IS DISTINCT FROM OLD.liquidity_tier
     OR NEW.liquidity_match_score IS DISTINCT FROM OLD.liquidity_match_score
     OR NEW.liquidity_bucket IS DISTINCT FROM OLD.liquidity_bucket
     OR NEW.target_vault IS DISTINCT FROM OLD.target_vault
     OR NEW.partner_share IS DISTINCT FROM OLD.partner_share
     OR NEW.active_owner IS DISTINCT FROM OLD.active_owner
     OR NEW.routing_rule IS DISTINCT FROM OLD.routing_rule
     OR NEW.has_signed_marketing_auth IS DISTINCT FROM OLD.has_signed_marketing_auth
     OR NEW.marketing_auth_signed_at IS DISTINCT FROM OLD.marketing_auth_signed_at
     OR NEW.is_fee_positive IS DISTINCT FROM OLD.is_fee_positive
     OR NEW.matched_fund_ids IS DISTINCT FROM OLD.matched_fund_ids THEN
    RAISE EXCEPTION 'OWNER_CANNOT_MODIFY_OPERATIONAL_FIELDS'
      USING ERRCODE = '42501',
            HINT = 'Use server-side RPCs to change operational state.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bbb_block_self_authorization()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR session_user IN ('service_role','postgres')
     OR (auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin')) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.buyer_id := COALESCE(auth.uid(), NEW.buyer_id);
    NEW.pre_binding_authorized := false;
    NEW.mpc_emd_authorized := false;
    NEW.mpc_signed_at := NULL;
    NEW.mpc_signature_name := NULL;
    NEW.deprecated_at := NULL;
    NEW.last_sale_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.buyer_id IS DISTINCT FROM OLD.buyer_id
     OR NEW.pre_binding_authorized IS DISTINCT FROM OLD.pre_binding_authorized
     OR NEW.mpc_emd_authorized IS DISTINCT FROM OLD.mpc_emd_authorized
     OR NEW.mpc_signed_at IS DISTINCT FROM OLD.mpc_signed_at
     OR NEW.mpc_signature_name IS DISTINCT FROM OLD.mpc_signature_name
     OR NEW.deprecated_at IS DISTINCT FROM OLD.deprecated_at
     OR NEW.last_sale_at IS DISTINCT FROM OLD.last_sale_at THEN
    RAISE EXCEPTION 'BUYER_CANNOT_SELF_AUTHORIZE'
      USING ERRCODE = '42501',
            HINT = 'Binding/EMD authority is granted by a signed server-side workflow.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bbb_block_self_authorization ON public.buyer_buy_boxes;
CREATE TRIGGER trg_bbb_block_self_authorization
BEFORE INSERT OR UPDATE ON public.buyer_buy_boxes
FOR EACH ROW EXECUTE FUNCTION public.bbb_block_self_authorization();