-- 1. SPV entity wrapping (Anti-Deed matrix)
CREATE TABLE IF NOT EXISTS public.spv_wrappers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  entity_name text NOT NULL,
  jurisdiction text NOT NULL DEFAULT 'WY',
  formation_status text NOT NULL DEFAULT 'Provisioned',
  registered_agent text,
  ein_status text NOT NULL DEFAULT 'Pending',
  mita_executed_at timestamptz,
  mita_buyer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS spv_wrappers_item_idx ON public.spv_wrappers(pipeline_item_id);
GRANT SELECT ON public.spv_wrappers TO authenticated;
GRANT ALL ON public.spv_wrappers TO service_role;
ALTER TABLE public.spv_wrappers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spv admin read" ON public.spv_wrappers FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 2. Maker/Taker liquidity incentives
CREATE TABLE IF NOT EXISTS public.maker_taker_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid,
  buyer_email text,
  standing_capital_usd numeric NOT NULL DEFAULT 0,
  standing_since timestamptz,
  classification text NOT NULL DEFAULT 'TAKER',
  fee_modifier_bps integer NOT NULL DEFAULT 0,
  last_evaluated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mtp_buyer_idx ON public.maker_taker_profiles(buyer_id);
GRANT SELECT ON public.maker_taker_profiles TO authenticated;
GRANT ALL ON public.maker_taker_profiles TO service_role;
ALTER TABLE public.maker_taker_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mtp admin read" ON public.maker_taker_profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 3. Cross-collateralized poison pill riders
CREATE TABLE IF NOT EXISTS public.poison_pill_riders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  buyer_email text,
  buyer_entity text,
  liquidated_damages_usd numeric NOT NULL DEFAULT 25000,
  confession_of_judgment boolean NOT NULL DEFAULT true,
  cross_collateral_scope text NOT NULL DEFAULT 'ALL_AFFILIATE_ENTITY_HOLDINGS',
  triggered_at timestamptz,
  trigger_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.poison_pill_riders TO authenticated;
GRANT ALL ON public.poison_pill_riders TO service_role;
ALTER TABLE public.poison_pill_riders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ppr admin read" ON public.poison_pill_riders FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 4. Pre-crime predictive staging
CREATE TABLE IF NOT EXISTS public.pre_distress_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  apn text,
  zip text,
  vectors jsonb NOT NULL DEFAULT '[]'::jsonb,
  score integer NOT NULL DEFAULT 0,
  level text NOT NULL DEFAULT 'Pre-Distress Level 1',
  staged_capital_usd numeric NOT NULL DEFAULT 0,
  outreach_dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pre_distress_signals TO authenticated;
GRANT ALL ON public.pre_distress_signals TO service_role;
ALTER TABLE public.pre_distress_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pds admin read" ON public.pre_distress_signals FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 5. TTL micro-auctions
CREATE TABLE IF NOT EXISTS public.ttl_micro_auctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  tier integer NOT NULL DEFAULT 1,
  buy_box_id uuid,
  buyer_id uuid,
  offer_price numeric NOT NULL,
  ttl_seconds integer NOT NULL DEFAULT 15,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'LIVE',
  ratchet_usd numeric NOT NULL DEFAULT 1000,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tma_live_idx ON public.ttl_micro_auctions(status, expires_at);
GRANT SELECT ON public.ttl_micro_auctions TO authenticated;
GRANT ALL ON public.ttl_micro_auctions TO service_role;
ALTER TABLE public.ttl_micro_auctions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tma admin read" ON public.ttl_micro_auctions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 6. Tax-loss harvesting cost ledger
CREATE TABLE IF NOT EXISTS public.cost_basis_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid,
  category text NOT NULL,
  micro_cost_usd numeric NOT NULL DEFAULT 0,
  fiscal_quarter text NOT NULL DEFAULT to_char(now(),'YYYY"Q"Q'),
  harvested boolean NOT NULL DEFAULT false,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cbl_quarter_idx ON public.cost_basis_ledger(fiscal_quarter);
GRANT SELECT ON public.cost_basis_ledger TO authenticated;
GRANT ALL ON public.cost_basis_ledger TO service_role;
ALTER TABLE public.cost_basis_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cbl admin read" ON public.cost_basis_ledger FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Expire TTL auctions and ratchet price up (fail-forward, bounded)
CREATE OR REPLACE FUNCTION public.sweep_ttl_auctions(_max integer DEFAULT 200)
RETURNS TABLE(auction_id uuid, deal_id uuid, new_price numeric, action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM public.ttl_micro_auctions
    WHERE status = 'LIVE' AND expires_at < now()
    ORDER BY expires_at ASC LIMIT _max
  LOOP
    UPDATE public.ttl_micro_auctions SET status = 'EXPIRED' WHERE id = r.id;
    UPDATE public.closing_pipeline_items
      SET base_contract_price = COALESCE(base_contract_price,0) + r.ratchet_usd
      WHERE id = r.pipeline_item_id AND cleared_at IS NULL;
    auction_id := r.id; deal_id := r.pipeline_item_id;
    new_price := r.offer_price + r.ratchet_usd; action := 'RATCHETED';
    RETURN NEXT;
  END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.sweep_ttl_auctions(integer) TO service_role;