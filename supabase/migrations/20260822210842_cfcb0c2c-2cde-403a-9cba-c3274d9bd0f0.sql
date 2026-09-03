REVOKE ALL ON FUNCTION public.sweep_micro_tif() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.m2m_claim_micro(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_micro_tif() TO service_role;
GRANT EXECUTE ON FUNCTION public.m2m_claim_micro(uuid, uuid, integer) TO service_role;