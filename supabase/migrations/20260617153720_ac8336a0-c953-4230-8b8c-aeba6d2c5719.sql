-- Restrict stripe session columns on closing_pipeline_items to service_role only
REVOKE SELECT (stripe_session_id, stripe_session_url, stripe_session_expires_at)
  ON public.closing_pipeline_items FROM authenticated;
REVOKE SELECT (stripe_session_id, stripe_session_url, stripe_session_expires_at)
  ON public.closing_pipeline_items FROM anon;

-- Restrict bundles read to admins only (fund reservation + pricing strategy data)
DROP POLICY IF EXISTS "Authenticated can read bundles" ON public.bundles;
CREATE POLICY "Admins can read bundles"
  ON public.bundles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Add explicit narrow SELECT policy on buyer_buy_boxes so a future broader ALL policy
-- can't accidentally widen reads. Owners + admins only.
CREATE POLICY "Owners and admins can read buy-boxes"
  ON public.buyer_buy_boxes FOR SELECT TO authenticated
  USING (auth.uid() = buyer_id OR public.has_role(auth.uid(), 'admin'));