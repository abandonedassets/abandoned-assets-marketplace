ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS composite_score numeric,
  ADD COLUMN IF NOT EXISTS risk_var_95 numeric,
  ADD COLUMN IF NOT EXISTS uw_ci_low numeric,
  ADD COLUMN IF NOT EXISTS uw_ci_high numeric;

CREATE TABLE IF NOT EXISTS public.deal_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  fund_id uuid,
  api_key_id uuid,
  action text NOT NULL,
  reason text,
  zip text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.deal_feedback TO service_role;
GRANT SELECT ON public.deal_feedback TO authenticated;
ALTER TABLE public.deal_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read deal_feedback" ON public.deal_feedback
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.submarket_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid,
  zip text NOT NULL,
  weight numeric NOT NULL DEFAULT 1.0,
  rejects integer NOT NULL DEFAULT 0,
  accepts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fund_id, zip)
);
GRANT ALL ON public.submarket_weights TO service_role;
GRANT SELECT ON public.submarket_weights TO authenticated;
ALTER TABLE public.submarket_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read submarket_weights" ON public.submarket_weights
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.system_config (key, value)
VALUES ('market_regime', '{"regime":"NEUTRAL","cap_rate_uplift_bps":0,"detected_at":null}'::jsonb)
ON CONFLICT (key) DO NOTHING;