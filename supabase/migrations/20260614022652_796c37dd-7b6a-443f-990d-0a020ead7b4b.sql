
REVOKE EXECUTE ON FUNCTION public.strike_lock_deal(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_endpoint_fill(uuid, bigint) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tif_sweep_expired_locks() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_bundle_totals(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_bundle_on_deal_change() FROM anon, authenticated, PUBLIC;
