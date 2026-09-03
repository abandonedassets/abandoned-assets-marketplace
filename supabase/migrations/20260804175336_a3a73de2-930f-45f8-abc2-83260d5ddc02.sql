
-- 1. GLOBAL SAFETY CONFIG
INSERT INTO public.system_config(key, value) VALUES
  ('SYSTEM_KILL_SWITCH', 'false'::jsonb),
  ('novation_threshold_usd', '20000'::jsonb),
  ('anti_circumvention_penalty_usd', '25000'::jsonb),
  ('emd_min_usd', '2500'::jsonb),
  ('watchdog_seconds', '3600'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2. BUYER PERSONA + URGENCY
DO $$ BEGIN
  CREATE TYPE public.buyer_persona AS ENUM (
    'EXCHANGE_1031','CONVERSION_1033','QOZ_FUND','BONUS_DEPRECIATION',
    'SDIRA_CASH','TIMO_SAWMILL','DRY_POWDER','HARD_MONEY_RECYCLER',
    'ADJACENT_OWNER','BTR_INFILL','GENERIC'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.buyer_buy_boxes
  ADD COLUMN IF NOT EXISTS persona public.buyer_persona NOT NULL DEFAULT 'GENERIC',
  ADD COLUMN IF NOT EXISTS capital_to_deploy_usd numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS window_start timestamptz,
  ADD COLUMN IF NOT EXISTS radius_miles integer NOT NULL DEFAULT 75,
  ADD COLUMN IF NOT EXISTS urgency_score numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.tax_mitigation_multiplier(_p public.buyer_persona)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _p
    WHEN 'EXCHANGE_1031' THEN 3.0
    WHEN 'CONVERSION_1033' THEN 2.5
    WHEN 'QOZ_FUND' THEN 2.2
    WHEN 'BONUS_DEPRECIATION' THEN 2.0
    WHEN 'SDIRA_CASH' THEN 1.8
    WHEN 'TIMO_SAWMILL' THEN 1.8
    WHEN 'DRY_POWDER' THEN 1.6
    WHEN 'HARD_MONEY_RECYCLER' THEN 1.4
    WHEN 'ADJACENT_OWNER' THEN 1.3
    WHEN 'BTR_INFILL' THEN 1.2
    ELSE 1.0 END
$$;

-- BUS = (capital / days remaining) * multiplier
CREATE OR REPLACE FUNCTION public.compute_buyer_urgency(
  _capital numeric, _window_expiration timestamptz, _persona public.buyer_persona
) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT ROUND(
    (COALESCE(_capital,0) / GREATEST(
        CASE WHEN _window_expiration IS NULL THEN 365
             ELSE EXTRACT(EPOCH FROM (_window_expiration - now()))/86400 END, 1)
    ) * public.tax_mitigation_multiplier(_persona), 2)
$$;

CREATE OR REPLACE FUNCTION public.bbb_score_urgency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.urgency_score := public.compute_buyer_urgency(
    NEW.capital_to_deploy_usd, NEW.window_expiration, NEW.persona);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bbb_score_urgency ON public.buyer_buy_boxes;
CREATE TRIGGER trg_bbb_score_urgency
  BEFORE INSERT OR UPDATE ON public.buyer_buy_boxes
  FOR EACH ROW EXECUTE FUNCTION public.bbb_score_urgency();

UPDATE public.buyer_buy_boxes SET updated_at = now();

-- 3. ROUTING RULES
CREATE TABLE IF NOT EXISTS public.asset_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  match_asset_type text,
  min_fee_usd numeric,
  parcel_parity text CHECK (parcel_parity IN ('even','odd')),
  target_vault text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.asset_routing_rules TO authenticated;
GRANT ALL ON public.asset_routing_rules TO service_role;
ALTER TABLE public.asset_routing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage routing rules" ON public.asset_routing_rules
  TO authenticated USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP TRIGGER IF EXISTS trg_arr_updated ON public.asset_routing_rules;
CREATE TRIGGER trg_arr_updated BEFORE UPDATE ON public.asset_routing_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.asset_routing_rules(name, priority, match_asset_type, min_fee_usd, parcel_parity, target_vault) VALUES
  ('Timber → Daughter Timber Vault', 10, 'TIMBER_LAND', NULL, NULL, 'daughter_timber_vault'),
  ('Fee ≥ $100k → ReelEdge Enterprise Vault', 20, NULL, 100000, NULL, 'reeledge_enterprise_vault'),
  ('Even parcel → Daughter Queue', 30, NULL, NULL, 'even', 'daughter_queue'),
  ('Odd parcel → ReelEdge Queue', 30, NULL, NULL, 'odd', 'reeledge_queue')
ON CONFLICT DO NOTHING;

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS target_vault text,
  ADD COLUMN IF NOT EXISTS estimated_stumpage_mbf numeric,
  ADD COLUMN IF NOT EXISTS contract_structure text,
  ADD COLUMN IF NOT EXISTS autopilot_state text NOT NULL DEFAULT 'Active',
  ADD COLUMN IF NOT EXISTS manual_entered_at timestamptz;

CREATE OR REPLACE FUNCTION public.cpi_route_vault()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _fee numeric := COALESCE(NEW.optimized_acquisition_premium, 0);
  _timber boolean := (COALESCE(NEW.asset_type,'') = 'TIMBER_LAND')
                     OR ('TIMBER' = ANY(COALESCE(NEW.enrichment_tags,'{}'::text[])));
  _digits text;
  _novation numeric := COALESCE((SELECT (value)::text::numeric FROM public.system_config WHERE key='novation_threshold_usd'), 20000);
BEGIN
  IF _timber THEN
    NEW.target_vault := 'daughter_timber_vault';
    IF NEW.estimated_stumpage_mbf IS NULL AND NEW.lot_sqft IS NOT NULL THEN
      -- ~8 MBF per acre standing timber heuristic
      NEW.estimated_stumpage_mbf := ROUND((NEW.lot_sqft / 43560.0) * 8, 2);
    END IF;
  ELSIF _fee >= 100000 THEN
    NEW.target_vault := 'reeledge_enterprise_vault';
  ELSE
    _digits := NULLIF(regexp_replace(COALESCE(NEW.apn, NEW.external_id, NEW.id::text), '\D', '', 'g'), '');
    IF _digits IS NOT NULL AND (right(_digits,1)::int % 2) = 0 THEN
      NEW.target_vault := 'daughter_queue';
    ELSE
      NEW.target_vault := 'reeledge_queue';
    END IF;
  END IF;

  NEW.contract_structure := CASE WHEN _fee > _novation THEN 'DOUBLE_CLOSE' ELSE 'ASSIGNMENT' END;

  IF NEW.autopilot_state = 'Manual' AND (TG_OP = 'INSERT' OR COALESCE(OLD.autopilot_state,'Active') <> 'Manual') THEN
    NEW.manual_entered_at := now();
  ELSIF NEW.autopilot_state = 'Active' THEN
    NEW.manual_entered_at := NULL;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cpi_route_vault ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_route_vault
  BEFORE INSERT OR UPDATE OF optimized_acquisition_premium, asset_type, enrichment_tags, autopilot_state
  ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_route_vault();

-- 4. 60-MINUTE WATCHDOG
CREATE OR REPLACE FUNCTION public.autopilot_watchdog_sweep()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _secs integer := COALESCE((SELECT (value)::text::integer FROM public.system_config WHERE key='watchdog_seconds'), 3600);
  _n integer := 0;
BEGIN
  WITH flipped AS (
    UPDATE public.closing_pipeline_items
       SET autopilot_state = 'Active', manual_entered_at = NULL
     WHERE autopilot_state = 'Manual'
       AND manual_entered_at IS NOT NULL
       AND manual_entered_at < now() - make_interval(secs => _secs)
     RETURNING id
  )
  SELECT count(*) INTO _n FROM flipped;

  IF _n > 0 THEN
    INSERT INTO public.system_alerts(kind, severity, message, metadata)
    VALUES ('WATCHDOG_TRIGGERED','info', _n || ' deal(s) auto-reverted to Autopilot after 60m of inaction', '{}'::jsonb);
  END IF;
  RETURN _n;
END $$;

REVOKE EXECUTE ON FUNCTION public.autopilot_watchdog_sweep() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cpi_route_vault() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bbb_score_urgency() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('autopilot-watchdog', '*/5 * * * *', $$SELECT public.autopilot_watchdog_sweep();$$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autopilot-watchdog');
