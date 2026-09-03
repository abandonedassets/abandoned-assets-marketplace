
-- Market-Alpha config flags
INSERT INTO public.system_config(key, value) VALUES
  ('market_alpha_enabled', 'true'::jsonb),
  ('tight_inventory_threshold', '5'::jsonb),
  ('aggressive_price_bump_pct', '0.01'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 1) Defect Leverage + 3) Prime-Alpha fast-track tagging
CREATE OR REPLACE FUNCTION public.cpi_market_alpha_tag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _tags text[] := COALESCE(NEW.enrichment_tags, '{}'::text[]);
  _enabled boolean;
BEGIN
  SELECT COALESCE((value)::text::boolean, true) INTO _enabled
  FROM public.system_config WHERE key = 'market_alpha_enabled';
  IF _enabled IS DISTINCT FROM true THEN RETURN NEW; END IF;

  -- Strip prior alpha tags for clean recompute
  _tags := ARRAY(SELECT unnest(_tags) EXCEPT SELECT unnest(ARRAY['HIGH-LEVERAGE','PRIME-ALPHA']));

  -- (1) High-Leverage: title defects / legal review become negotiation leverage
  IF COALESCE(NEW.requires_legal_review,false) = true
     OR lower(COALESCE(NEW.title_status,'')) IN ('uninsurable','pending')
     OR lower(COALESCE(NEW.title_notes,'')) ~ '(lien|quitclaim|defect|cloud)' THEN
    _tags := array_append(_tags, 'HIGH-LEVERAGE');
  END IF;

  -- (3) Prime-Alpha: perfect liquidity match → fast-track flag
  IF COALESCE(NEW.liquidity_match_score,0) >= 10
     AND COALESCE(NEW.manual_review,false) = false
     AND COALESCE(NEW.requires_legal_review,false) = false
     AND NEW.status::text NOT IN ('Funds-Cleared','Closed','Dead','Rejected') THEN
    _tags := array_append(_tags, 'PRIME-ALPHA');
    NEW.auto_clearance_ready := true;
  END IF;

  NEW.enrichment_tags := ARRAY(SELECT DISTINCT unnest(_tags));
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_cpi_market_alpha_tag ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_market_alpha_tag
BEFORE INSERT OR UPDATE ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.cpi_market_alpha_tag();

-- 2) Competitive Inventory Scan: tight zips → bump matching buy_boxes 1%
CREATE OR REPLACE FUNCTION public.competitive_inventory_scan()
RETURNS TABLE(zip text, active_inventory int, bumped_buy_boxes int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _enabled boolean; _threshold int; _bump numeric;
  _r RECORD; _n int;
BEGIN
  SELECT COALESCE((value)::text::boolean,true) INTO _enabled FROM public.system_config WHERE key='market_alpha_enabled';
  IF _enabled IS DISTINCT FROM true THEN RETURN; END IF;

  SELECT COALESCE((value)::text::int,5) INTO _threshold FROM public.system_config WHERE key='tight_inventory_threshold';
  SELECT COALESCE((value)::text::numeric,0.01) INTO _bump FROM public.system_config WHERE key='aggressive_price_bump_pct';

  FOR _r IN
    SELECT c.zip, COUNT(*)::int AS inv
    FROM public.closing_pipeline_items c
    WHERE c.zip IS NOT NULL
      AND c.status::text IN ('New','Scout','House-Bid')
      AND COALESCE(c.is_held,false)=false
    GROUP BY c.zip
  LOOP
    IF _r.inv < _threshold THEN
      WITH upd AS (
        UPDATE public.buyer_buy_boxes
           SET max_contract_price = ROUND(max_contract_price * (1 + _bump), 2),
               updated_at = now()
         WHERE active = true
           AND deprecated_at IS NULL
           AND _r.zip = ANY(target_zip_codes)
         RETURNING 1
      )
      SELECT COUNT(*) INTO _n FROM upd;

      IF _n > 0 THEN
        INSERT INTO public.system_alerts(severity, kind, message, metadata)
        VALUES ('low','market_alpha_price_bump',
          format('Tight inventory in %s (%s active) → bumped %s buy-boxes by %s%%',
                 _r.zip, _r.inv, _n, (_bump*100)::text),
          jsonb_build_object('zip',_r.zip,'inventory',_r.inv,'bumped',_n));
      END IF;

      zip := _r.zip; active_inventory := _r.inv; bumped_buy_boxes := COALESCE(_n,0);
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$fn$;

-- Hourly competitive scan
SELECT cron.unschedule('competitive-inventory-scan')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='competitive-inventory-scan');

SELECT cron.schedule(
  'competitive-inventory-scan',
  '0 * * * *',
  $$SELECT public.competitive_inventory_scan();$$
);
