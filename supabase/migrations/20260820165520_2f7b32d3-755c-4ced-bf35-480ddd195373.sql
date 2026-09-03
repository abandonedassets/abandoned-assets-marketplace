
REVOKE EXECUTE ON FUNCTION public.assemble_contract_payload(uuid, uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.offer_deal_tif(uuid, uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.process_tif_expirations() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.execute_buyer_contract(uuid, text, text, text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.assemble_contract_payload(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.offer_deal_tif(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_tif_expirations() TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_buyer_contract(uuid, text, text, text) TO service_role;
