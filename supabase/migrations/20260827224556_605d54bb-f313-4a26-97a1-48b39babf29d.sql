CREATE TABLE IF NOT EXISTS public.escrow_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  title_company text,
  title_api_url text,
  order_status text NOT NULL DEFAULT 'PENDING_OPEN',
  contract_hash text NOT NULL,
  opened_at timestamptz,
  last_ping_at timestamptz,
  next_ping_at timestamptz,
  ping_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  circuit_state text NOT NULL DEFAULT 'CLOSED',
  hash_mismatch boolean NOT NULL DEFAULT false,
  closing_disclosure_url text,
  last_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id)
);
GRANT SELECT ON public.escrow_orders TO authenticated;
GRANT ALL ON public.escrow_orders TO service_role;
ALTER TABLE public.escrow_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "escrow_orders_admin_read" ON public.escrow_orders
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.penny_test_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  salt_date date NOT NULL DEFAULT CURRENT_DATE,
  amount_a_cents integer NOT NULL,
  amount_b_cents integer NOT NULL,
  lock_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ISSUED',
  matched_at timestamptz,
  stripe_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.penny_test_verifications TO authenticated;
GRANT ALL ON public.penny_test_verifications TO service_role;
ALTER TABLE public.penny_test_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "penny_tests_admin_read" ON public.penny_test_verifications
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_escrow_orders_updated BEFORE UPDATE ON public.escrow_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_penny_tests_updated BEFORE UPDATE ON public.penny_test_verifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();