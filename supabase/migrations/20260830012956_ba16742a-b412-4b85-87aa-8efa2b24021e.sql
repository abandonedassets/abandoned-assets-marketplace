ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS entity_name TEXT DEFAULT 'Ironclad Assets';

CREATE OR REPLACE VIEW public.deal_allocations_view
WITH (security_invoker = true) AS
WITH parsed_deals AS (
  SELECT
    id,
    address AS address_raw,
    zip,
    UPPER(COALESCE(state, 'US')) AS state_clean,
    COALESCE(asset_class, 'Land') AS asset_class_clean,
    parcel_number,
    acreage,
    COALESCE(base_contract_price, 0) AS deal_val,
    COALESCE(optimized_acquisition_premium, 0) AS fee,
    status::text AS status,
    created_at,
    CASE
      WHEN parcel_number IS NOT NULL AND regexp_replace(parcel_number, '\D', '', 'g') <> ''
        THEN (CAST(RIGHT(regexp_replace(parcel_number, '\D', '', 'g'), 9) AS BIGINT) % 2 <> 0)
      ELSE (id::text ILIKE '%1%' OR id::text ILIKE '%3%' OR id::text ILIKE '%5%' OR id::text ILIKE '%7%' OR id::text ILIKE '%9%')
    END AS is_odd_parcel
  FROM public.closing_pipeline_items
)
SELECT
  id,
  address_raw,
  zip,
  state_clean AS state,
  asset_class_clean AS asset_class,
  parcel_number,
  acreage,
  deal_val AS contract_price,
  fee AS assignment_fee,
  status,
  created_at,
  is_odd_parcel,
  CASE
    WHEN state_clean = 'IN' AND asset_class_clean IN ('Land','Timber','Modular','Land & Timber') THEN 'JAQUITA'
    WHEN state_clean <> 'IN' AND asset_class_clean IN ('Land','Timber','Land & Timber') THEN 'JAZMIN'
    WHEN asset_class_clean IN ('Commercial','Residential','SFR','Multi-Family') AND deal_val < 100000
      THEN CASE WHEN is_odd_parcel THEN 'JAZMIN' ELSE 'OWNER' END
    ELSE 'OWNER'
  END AS primary_beneficiary,
  CASE WHEN state_clean = 'IN' AND asset_class_clean IN ('Land','Timber','Modular','Land & Timber') THEN fee ELSE 0 END AS jaquita_share,
  CASE WHEN (state_clean <> 'IN' AND asset_class_clean IN ('Land','Timber','Land & Timber'))
         OR (asset_class_clean IN ('Commercial','Residential','SFR','Multi-Family') AND deal_val < 100000 AND is_odd_parcel)
       THEN fee ELSE 0 END AS jasmine_share,
  CASE WHEN (asset_class_clean IN ('Commercial','Residential','SFR','Multi-Family') AND deal_val >= 100000)
         OR (asset_class_clean IN ('Commercial','Residential','SFR','Multi-Family') AND deal_val < 100000 AND NOT is_odd_parcel)
         OR (asset_class_clean NOT IN ('Land','Timber','Land & Timber','Modular','Commercial','Residential','SFR','Multi-Family'))
       THEN fee ELSE 0 END AS owner_share
FROM parsed_deals;

GRANT SELECT ON public.deal_allocations_view TO authenticated;
GRANT SELECT ON public.deal_allocations_view TO service_role;

CREATE OR REPLACE FUNCTION public.get_current_partner_role()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  v_email := LOWER(COALESCE(auth.jwt() ->> 'email', ''));
  IF v_email LIKE '%jazmin%' OR v_email LIKE '%ironclad%' THEN RETURN 'JAZMIN';
  ELSIF v_email LIKE '%jaquita%' THEN RETURN 'JAQUITA';
  ELSE RETURN 'ADMIN';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_current_partner_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_partner_role() TO authenticated;