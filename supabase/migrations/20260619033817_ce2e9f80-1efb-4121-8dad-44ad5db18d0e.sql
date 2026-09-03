
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS liquidity_tier text;

CREATE INDEX IF NOT EXISTS idx_cpi_liquidity_tier ON public.closing_pipeline_items(liquidity_tier);

CREATE OR REPLACE FUNCTION public.route_and_assign_asset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _fee numeric := COALESCE(NEW.optimized_acquisition_premium, 0);
  _last_hex text;
  _parity int;
  _owner text;
  _rule text;
  _share numeric := 0;
  _tier text := 'Standard';
BEGIN
  IF _fee >= 100000 THEN
    _owner := 'Master';
    _rule  := 'Routing: Fee>=100k Whale-Class -> Master Assigned (Tier-1 Segregated)';
    _tier  := 'Tier-1';
  ELSE
    _last_hex := lower(substr(NEW.id::text, length(NEW.id::text), 1));
    _parity := ('x' || _last_hex)::bit(4)::int % 2;
    IF _parity = 1 THEN
      _owner := 'Partner';
      _rule  := 'Routing: Odd-ID Partition -> Partner Assigned';
      _share := round(_fee * 0.50, 2);
    ELSE
      _owner := 'Master';
      _rule  := 'Routing: Even-ID Partition -> Master Assigned';
      _share := round(_fee * 0.50, 2);
    END IF;
  END IF;

  NEW.active_owner   := _owner;
  NEW.partner_share  := CASE WHEN _owner = 'Partner' THEN _share ELSE 0 END;
  NEW.routing_rule   := _rule;
  NEW.liquidity_tier := _tier;

  BEGIN
    INSERT INTO public.system_diagnostic_log(
      pipeline_item_id, active_owner, fee, partner_share, rule, metadata
    ) VALUES (
      NEW.id, _owner, _fee, NEW.partner_share, _rule,
      jsonb_build_object('zip', NEW.zip, 'price', NEW.base_contract_price, 'liquidity_tier', _tier)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NEW;
END;
$$;

UPDATE public.closing_pipeline_items
SET liquidity_tier = CASE
  WHEN COALESCE(optimized_acquisition_premium, 0) >= 100000 THEN 'Tier-1'
  ELSE 'Standard'
END
WHERE liquidity_tier IS NULL;

DROP VIEW IF EXISTS public.tier1_dark_pool_view;
CREATE VIEW public.tier1_dark_pool_view
WITH (security_invoker = true) AS
SELECT
  id,
  COALESCE(address, zip) AS property_address,
  zip,
  base_contract_price,
  optimized_acquisition_premium AS fee,
  status,
  active_owner,
  routing_rule,
  liquidity_tier,
  confidence_score,
  manual_review,
  title_status,
  created_at,
  updated_at
FROM public.closing_pipeline_items
WHERE liquidity_tier = 'Tier-1';

GRANT SELECT ON public.tier1_dark_pool_view TO authenticated;
