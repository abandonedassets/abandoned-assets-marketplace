REVOKE EXECUTE ON FUNCTION public.sovereign_claim(uuid, text, bigint, text, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sovereign_signature_unblock(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sovereign_claim(uuid, text, bigint, text, text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.sovereign_signature_unblock(uuid, text) TO service_role;