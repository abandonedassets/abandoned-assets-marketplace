-- system_metrics: explicit admin read access
GRANT SELECT ON public.system_metrics TO authenticated;
GRANT ALL ON public.system_metrics TO service_role;
DROP POLICY IF EXISTS "Admins can read system metrics" ON public.system_metrics;
CREATE POLICY "Admins can read system metrics"
ON public.system_metrics FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- buyer_waitlist: writes only via trusted backend (service role), no anon/authenticated inserts
REVOKE INSERT ON public.buyer_waitlist FROM anon;
GRANT ALL ON public.buyer_waitlist TO service_role;
DROP POLICY IF EXISTS "Service role manages waitlist" ON public.buyer_waitlist;
CREATE POLICY "Service role manages waitlist"
ON public.buyer_waitlist FOR ALL TO service_role
USING (true) WITH CHECK (true);