REVOKE EXECUTE ON FUNCTION public.resuscitate_stagnant_deals(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resuscitate_stagnant_deals(integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.sal_block_mutation() FROM PUBLIC, anon, authenticated;