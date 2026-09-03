
-- Revoke EXECUTE from authenticated/PUBLIC on safe-trigger and safe-cron functions.
-- Keep frontend-called RPCs (Exempt) intact.

REVOKE EXECUTE ON FUNCTION public.adversarial_audit_cpi() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.alert_legal_hold() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.alert_terminal_failure() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.algorithmic_price_adjustment() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_bundle_orphaned_assets(integer, integer, integer) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_clear_eligible_deals() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.calculate_pipeline_fee(numeric) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.competitive_inventory_scan() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_assignment_fee(numeric, numeric) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_confidence_score(text, numeric) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_emd_amount(numeric, text[]) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_liquidity_match(closing_pipeline_items) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_apply_virtual_funding_credit() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_autoprice_premium() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_block_active_delete() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_block_owner_sensitive_updates() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_bump_row_version() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_enforce_locked_fee_immutability() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_enrich_capital_tags() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_fire_reverse_strike() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_log_rejection_telemetry() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_market_alpha_tag() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_open_shadow_escrow() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_route_to_exception_queue() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_scout_router() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_set_confidence() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_stamp_emd() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_stamp_escrow_pending() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpi_write_audit_log() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.detect_assemblage_groups() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dlq_emit_alert() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.drip_shadow_escrow() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_title_hardening() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.eod_settlement_summary(integer) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_pipeline_status_change() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.market_telemetry_summary(integer) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.observer_sweep_stale() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_scout_mutation() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_scout_deals() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_system_metrics() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resuscitate_pipeline_item(uuid) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.route_and_assign_asset() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_auto_clearance_ready() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.strike_lock_deal(uuid, uuid) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sweep_exception_queue(integer) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.telemetry_heartbeat() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_cpi_score_liquidity() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_refresh_metrics_on_pipeline_change() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM authenticated, PUBLIC;

-- Exempt (kept callable by authenticated): assemblage_radar_snapshot,
-- clear_funds_idempotent, cleared_today_usd, cvi_metrics,
-- detect_assemblage_groups (authenticated only), mission_control_pulse.
