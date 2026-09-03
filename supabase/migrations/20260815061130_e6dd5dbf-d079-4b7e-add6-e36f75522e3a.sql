-- 1. plaid_items: backend-only (holds access tokens)
REVOKE ALL ON public.plaid_items FROM anon, authenticated;
GRANT ALL ON public.plaid_items TO service_role;

-- 2. c2c_capital_pool: no client writes
REVOKE INSERT, UPDATE, DELETE ON public.c2c_capital_pool FROM anon, authenticated;
GRANT ALL ON public.c2c_capital_pool TO service_role;

-- 3. plaid_transfers: owner read, no client writes
REVOKE INSERT, UPDATE, DELETE ON public.plaid_transfers FROM anon, authenticated;
REVOKE ALL ON public.plaid_transfers FROM anon;
GRANT SELECT ON public.plaid_transfers TO authenticated;
GRANT ALL ON public.plaid_transfers TO service_role;

DROP POLICY IF EXISTS "Deal owners can view their own transfers" ON public.plaid_transfers;
CREATE POLICY "Deal owners can view their own transfers"
ON public.plaid_transfers
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.closing_pipeline_items cpi
    WHERE cpi.id = plaid_transfers.deal_id
      AND cpi.user_id = auth.uid()
  )
);