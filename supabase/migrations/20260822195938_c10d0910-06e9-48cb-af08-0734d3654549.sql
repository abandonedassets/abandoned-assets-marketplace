-- 1) Explicit admin DELETE on closing_pipeline_items
DROP POLICY IF EXISTS "cpi_admin_delete" ON public.closing_pipeline_items;
CREATE POLICY "cpi_admin_delete" ON public.closing_pipeline_items
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 2) Explicit admin-only SELECT on system_metrics (covers realtime postgres_changes)
ALTER TABLE public.system_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "system_metrics_admin_select" ON public.system_metrics;
CREATE POLICY "system_metrics_admin_select" ON public.system_metrics
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
REVOKE ALL ON public.system_metrics FROM anon;

-- 3) payout_recipient_profiles: lock down explicitly to service_role only
ALTER TABLE public.payout_recipient_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payout_recipient_profiles FROM anon, authenticated;
GRANT ALL ON public.payout_recipient_profiles TO service_role;
DROP POLICY IF EXISTS "payout_recipient_profiles_no_client_access" ON public.payout_recipient_profiles;
CREATE POLICY "payout_recipient_profiles_no_client_access" ON public.payout_recipient_profiles
FOR SELECT TO authenticated
USING (false);