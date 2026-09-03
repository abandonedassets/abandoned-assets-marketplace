REVOKE ALL ON FUNCTION public.reject_offer(uuid, public.offer_rejection_code, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_offer(uuid, public.offer_rejection_code, numeric, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.offer_telemetry_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offer_telemetry_summary() TO authenticated, service_role;