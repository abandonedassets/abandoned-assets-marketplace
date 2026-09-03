
REVOKE EXECUTE ON FUNCTION public.start_deal_reservation(uuid, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sweep_expired_reservations() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_deal_reservation(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_expired_reservations() TO service_role;
