
REVOKE EXECUTE ON FUNCTION public.strike_lock_deal(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.strike_lock_deal(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.strike_lock_deal(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.strike_lock_deal(UUID, UUID) TO service_role;
