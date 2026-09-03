REVOKE ALL ON FUNCTION public.record_buyer_event(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_buyer_event(text, text) TO service_role;