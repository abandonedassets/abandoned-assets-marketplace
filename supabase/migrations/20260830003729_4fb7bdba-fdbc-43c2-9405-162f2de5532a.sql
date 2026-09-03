REVOKE EXECUTE ON FUNCTION public.decay_stale_assignment_fees(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.preflight_validate_lead(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.m2m_claim_dispatch(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decay_stale_assignment_fees(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.preflight_validate_lead(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.m2m_claim_dispatch(uuid, uuid, integer) TO service_role;