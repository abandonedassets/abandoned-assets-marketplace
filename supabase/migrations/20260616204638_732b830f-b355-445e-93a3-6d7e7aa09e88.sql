
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS spread_score NUMERIC,
  ADD COLUMN IF NOT EXISTS spread_multiplier NUMERIC NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS yield_class TEXT;

ALTER TABLE public.buyer_buy_boxes
  ADD COLUMN IF NOT EXISTS buyer_priority TEXT,
  ADD COLUMN IF NOT EXISTS window_expiration TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sale_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_buyer_buy_boxes_window ON public.buyer_buy_boxes(window_expiration) WHERE active = true;

-- Replace matching function to honor urgency-based 2% margin discount
CREATE OR REPLACE FUNCTION public.match_orange_squares()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _bb RECORD;
  _eff_type TEXT;
BEGIN
  IF NEW.status::text IN ('Funds-Cleared','Closed','Dead','CRITICAL_STALL') THEN
    RETURN NEW;
  END IF;

  NEW.auto_clearance_ready := COALESCE(NEW.optimized_acquisition_premium, 0) >= 10000;

  IF NEW.matched_buyer_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  _eff_type := COALESCE(NEW.asset_type, 'SFR');

  SELECT id, buyer_id
    INTO _bb
  FROM public.buyer_buy_boxes
  WHERE active = true
    AND deprecated_at IS NULL
    AND NEW.zip = ANY(target_zip_codes)
    AND _eff_type = ANY(target_asset_types)
    AND COALESCE(NEW.base_contract_price, 0) <= max_contract_price
    AND COALESCE(NEW.optimized_acquisition_premium, 0) >=
      CASE
        WHEN window_expiration IS NOT NULL AND window_expiration - now() < interval '30 days'
          THEN min_placement_margin * 0.98
        ELSE min_placement_margin
      END
  ORDER BY
    CASE WHEN buyer_priority = '1031-ACTIVE' THEN 0 ELSE 1 END,
    window_expiration NULLS LAST,
    created_at ASC
  LIMIT 1;

  IF FOUND THEN
    NEW.matched_buyer_id := _bb.buyer_id;
    NEW.matched_buy_box_id := _bb.id;
    NEW.auto_clearance_ready := true;
  END IF;

  RETURN NEW;
END;
$function$;

-- Self-cleaning: deprecate buy-boxes whose window expired without clearing an asset
CREATE OR REPLACE FUNCTION public.deprecate_stale_buy_boxes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _count integer;
BEGIN
  WITH cleared AS (
    SELECT DISTINCT matched_buy_box_id AS id
    FROM public.closing_pipeline_items
    WHERE matched_buy_box_id IS NOT NULL
      AND status::text IN ('Funds-Cleared','Closed')
  ),
  upd AS (
    UPDATE public.buyer_buy_boxes b
    SET active = false, deprecated_at = now(), updated_at = now()
    WHERE active = true
      AND window_expiration IS NOT NULL
      AND window_expiration < now()
      AND b.id NOT IN (SELECT id FROM cleared WHERE id IS NOT NULL)
    RETURNING 1
  )
  SELECT count(*) INTO _count FROM upd;
  RETURN COALESCE(_count, 0);
END;
$function$;
