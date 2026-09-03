CREATE OR REPLACE VIEW public.qre_institutional_deal_tape
WITH (security_invoker = true) AS
SELECT
  id::text AS asset_id,
  COALESCE(NULLIF(address,''), 'Undisclosed Asset') AS address,
  COALESCE(NULLIF(city,''), 'Dayton') AS market,
  COALESCE(NULLIF(state,''), 'OH') AS state_module,
  COALESCE(base_contract_price, absolute_floor_price, assessed_value, 0)::numeric AS cost_basis,
  COALESCE(assessed_value, ROUND(base_contract_price * 1.35), 0)::numeric AS arv_projection,
  COALESCE(status::text, 'unverified') AS status,
  COALESCE(NULLIF(zip,''), 'unknown') AS micro_market,
  md5(COALESCE(zip, city, 'dayton') || ':' || COALESCE(state, 'OH')) AS portfolio_id,
  now() AS feed_generated_at
FROM public.closing_pipeline_items
WHERE status::text NOT IN ('Dead','Rejected');

GRANT SELECT ON public.qre_institutional_deal_tape TO anon, authenticated;