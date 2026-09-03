DROP POLICY IF EXISTS "admins read ingest_runs" ON public.ingest_runs;
CREATE POLICY "admins read ingest_runs" ON public.ingest_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "admins manage system_flags" ON public.system_flags;
CREATE POLICY "admins manage system_flags" ON public.system_flags FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "system_metrics_admin_read" ON public.system_metrics;
CREATE POLICY "system_metrics_admin_read" ON public.system_metrics FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

REVOKE ALL ON public.ingest_runs FROM anon;
REVOKE ALL ON public.system_flags FROM anon;
REVOKE ALL ON public.system_metrics FROM anon;
GRANT SELECT ON public.ingest_runs TO authenticated;
GRANT SELECT ON public.system_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_flags TO authenticated;