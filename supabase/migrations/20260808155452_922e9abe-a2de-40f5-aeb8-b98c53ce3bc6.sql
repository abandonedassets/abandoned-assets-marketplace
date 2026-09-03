
REVOKE ALL ON FUNCTION public.buyer_density(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.compute_dynamic_spread(numeric, numeric, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_offer_ratchet() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buyer_density(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_dynamic_spread(numeric, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_offer_ratchet() TO service_role;
