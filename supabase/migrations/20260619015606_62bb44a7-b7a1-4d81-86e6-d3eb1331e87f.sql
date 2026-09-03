DROP POLICY IF EXISTS system_metrics_read_auth ON public.system_metrics;
CREATE POLICY system_metrics_admin_read ON public.system_metrics
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));