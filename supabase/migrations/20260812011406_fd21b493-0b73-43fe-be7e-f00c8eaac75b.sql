ALTER FUNCTION public.compute_assignment_fee(numeric,numeric) SET search_path = public;
ALTER FUNCTION public.compute_assignment_fee(numeric,numeric,numeric) SET search_path = public;

DROP POLICY IF EXISTS "authenticated can read transfers" ON public.plaid_transfers;
CREATE POLICY "admins can read transfers" ON public.plaid_transfers
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));