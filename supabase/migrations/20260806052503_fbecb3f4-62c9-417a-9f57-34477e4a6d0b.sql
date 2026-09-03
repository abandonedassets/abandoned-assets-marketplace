SET session_replication_role = replica;

DELETE FROM public.shadow_liquidity_queue WHERE label ILIKE '%SYNTHETIC%' OR label ILIKE '%TITANIC%';
DELETE FROM public.institutional_api_request_log;
DELETE FROM public.institutional_api_keys WHERE label ILIKE '%SYNTHETIC%';
DELETE FROM public.m2m_executions;
DELETE FROM public.title_packages;
DELETE FROM public.title_cloud_recordings;
DELETE FROM public.shadow_escrow_ledger;
DELETE FROM public.esign_requests;
DELETE FROM public.audit_vault_exports;
DELETE FROM public.reverse_strike_queue;
DELETE FROM public.exception_queue;
DELETE FROM public.processed_ledger_events;
DELETE FROM public.webhook_replay_guard;
DELETE FROM public.resilient_outbox;
DELETE FROM public.market_telemetry;
DELETE FROM public.routing_dispatch_log;
DELETE FROM public.system_diagnostic_log;
DELETE FROM public.pipeline_status_history;
DELETE FROM public.system_alerts;
DELETE FROM public.system_audit_logs;
DELETE FROM public.system_audit_log;
DELETE FROM public.inbound_email_log;
DELETE FROM public.dead_letter_queue;
DELETE FROM public.ingest_runs;
DELETE FROM public.system_metrics;

UPDATE public.closing_pipeline_items SET
  status = 'Scout',
  escrow_status = NULL,
  cleared_at = NULL,
  cleared_amount = NULL,
  stripe_session_id = NULL,
  stripe_session_url = NULL,
  stripe_session_expires_at = NULL,
  tif_state = NULL,
  tif_expires_at = NULL,
  tif_dispatched_at = NULL,
  matched_buyer_id = NULL,
  matched_buy_box_id = NULL,
  bundle_id = NULL,
  locked_at = NULL,
  locked_by_key_id = NULL,
  active_owner = NULL,
  partner_share = NULL,
  escrow_pending_at = NULL,
  sovereign_override = false;

DELETE FROM public.bundles;

SET session_replication_role = origin;

CREATE OR REPLACE FUNCTION public.cpi_require_live_stripe_clearance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.status = 'Funds-Cleared' OR NEW.cleared_at IS NOT NULL OR NEW.escrow_status = 'CLEARED') THEN
    IF NEW.stripe_session_id IS NULL
       OR NOT (NEW.stripe_session_id ~ '^(pi_|cs_|in_|ch_)')
       OR NEW.stripe_session_id ILIKE '%synthetic%'
       OR NEW.stripe_session_id ILIKE '%test%' THEN
      RAISE EXCEPTION 'Live clearance required: a verified Stripe payment reference must be attached before a deal can clear';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_require_live_stripe_clearance ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_require_live_stripe_clearance
BEFORE INSERT OR UPDATE ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.cpi_require_live_stripe_clearance();

ALTER TABLE public.shadow_liquidity_queue
  DROP CONSTRAINT IF EXISTS slq_live_https_webhook;
ALTER TABLE public.shadow_liquidity_queue
  ADD CONSTRAINT slq_live_https_webhook
  CHECK (webhook_target_url ~* '^https://' AND webhook_target_url NOT ILIKE '%localhost%' AND webhook_target_url NOT ILIKE '%/api/test/%');