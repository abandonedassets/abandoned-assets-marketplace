-- Restrict buyer scorecards to admins only
DROP POLICY IF EXISTS "Staff can read buyer scorecards" ON public.buyer_scorecards;
CREATE POLICY "Admins read buyer scorecards"
ON public.buyer_scorecards FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Explicit admin-only SELECT for POF verifications (sensitive financial data)
DROP POLICY IF EXISTS "Admins read buyer pof verifications" ON public.buyer_pof_verifications;
CREATE POLICY "Admins read buyer pof verifications"
ON public.buyer_pof_verifications FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Explicit admin-scoped write policies for wire accounts
DROP POLICY IF EXISTS "admins insert fbo accounts" ON public.inbound_wire_accounts;
CREATE POLICY "admins insert fbo accounts"
ON public.inbound_wire_accounts FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "admins update fbo accounts" ON public.inbound_wire_accounts;
CREATE POLICY "admins update fbo accounts"
ON public.inbound_wire_accounts FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "admins delete fbo accounts" ON public.inbound_wire_accounts;
CREATE POLICY "admins delete fbo accounts"
ON public.inbound_wire_accounts FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));