
REVOKE EXECUTE ON FUNCTION public.recalc_bundle_totals(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_bundle_on_deal_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_bundle_totals(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_bundle_on_deal_change() TO service_role;
