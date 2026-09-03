CREATE OR REPLACE FUNCTION public.preflight_validate_lead(_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $func$
WITH r AS (
  SELECT * FROM public.closing_pipeline_items WHERE id = _id
),
problems AS (
  SELECT array_remove(ARRAY[
    CASE WHEN COALESCE(trim(r.address),'') = '' OR COALESCE(trim(r.zip),'') = '' THEN 'NO_NORMALIZED_ADDRESS' END,
    CASE WHEN COALESCE(trim(COALESCE(r.owner_entity, r.active_owner, '')),'') = '' THEN 'NO_VERIFIED_OWNER' END,
    CASE
      WHEN COALESCE(r.calculated_arv,0) <= 0 THEN 'NO_VALUATION'
      WHEN (COALESCE(r.calculated_arv,0) * 0.7) - COALESCE(r.estimated_repairs,0) - COALESCE(r.base_contract_price,0) < COALESCE(r.optimized_acquisition_premium,0) THEN 'INSUFFICIENT_EQUITY_SPREAD'
    END
  ], NULL) AS p
  FROM r
),
upd_ready AS (
  UPDATE public.closing_pipeline_items c
     SET reverse_strike_ready = true, updated_at = now()
    WHERE c.id = _id
      AND EXISTS (SELECT 1 FROM problems WHERE array_length(p, 1) IS NULL)
  RETURNING c.id
),
upd_bad AS (
  UPDATE public.closing_pipeline_items c
     SET reverse_strike_ready = false,
         enrichment_tags = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(c.enrichment_tags, ARRAY[]::text[]) || ARRAY['INVALID_LEAD']))),
         updated_at = now()
    WHERE c.id = _id
      AND EXISTS (SELECT 1 FROM problems WHERE array_length(p, 1) > 0)
  RETURNING c.id
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM r) THEN jsonb_build_object('ok', false, 'error', 'not_found')
  WHEN EXISTS (SELECT 1 FROM upd_ready) THEN jsonb_build_object('ok', true, 'state', 'REVERSE_STRIKE_READY')
  ELSE jsonb_build_object('ok', false, 'state', 'INVALID_LEAD', 'problems', (SELECT to_jsonb(p) FROM problems))
END
$func$