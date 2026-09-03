
CREATE OR REPLACE FUNCTION public.cpi_block_owner_sensitive_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- service_role bypasses (server-side admin client, SECURITY DEFINER RPCs run as definer)
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
     OR NEW.source IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION 'OWNER_CANNOT_MODIFY_OPERATIONAL_FIELDS'
      USING ERRCODE = '42501',
            HINT = 'Use server-side RPCs (strike_lock_deal, clear_funds_idempotent) to change operational state.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_block_owner_sensitive ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_block_owner_sensitive
  BEFORE UPDATE ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_block_owner_sensitive_updates();
