
REVOKE EXECUTE ON FUNCTION public.execute_autonomous_settlements() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_autonomous_settlements() TO service_role;
REVOKE EXECUTE ON FUNCTION public.bridge_waitlist_conversion() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_process_waitlist() FROM anon, authenticated, PUBLIC;
