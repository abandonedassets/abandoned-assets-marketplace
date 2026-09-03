ALTER TYPE public.app_pipeline_status ADD VALUE IF NOT EXISTS 'Shadow_Matched';

CREATE TABLE IF NOT EXISTS public.shadow_liquidity_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL,
  label text,
  target_zip_codes text[] NOT NULL DEFAULT '{}',
  target_asset_types text[] NOT NULL DEFAULT '{}',
  max_purchase_price numeric NOT NULL,
  required_margin_percentage numeric NOT NULL DEFAULT 0,
  webhook_target_url text NOT NULL,
  allocated_capital_usd numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  last_matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shadow_liquidity_queue TO authenticated;
GRANT ALL ON public.shadow_liquidity_queue TO service_role;

ALTER TABLE public.shadow_liquidity_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "slq_owner_all" ON public.shadow_liquidity_queue
  FOR ALL TO authenticated
  USING (auth.uid() = buyer_id)
  WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "slq_admin_select" ON public.shadow_liquidity_queue
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_slq_updated_at
  BEFORE UPDATE ON public.shadow_liquidity_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_slq_active ON public.shadow_liquidity_queue (is_active, max_purchase_price);

-- Zero-trust: no anonymous execution of privileged (SECURITY DEFINER) routines.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;