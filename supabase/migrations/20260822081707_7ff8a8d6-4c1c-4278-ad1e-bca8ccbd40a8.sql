REVOKE ALL ON FUNCTION public.bw_sanitize_public_insert() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.ce_sanitize_public_insert() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.slq_validate_webhook() FROM anon, authenticated;