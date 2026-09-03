
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS zoning_category text,
  ADD COLUMN IF NOT EXISTS buyer_channel text,
  ADD COLUMN IF NOT EXISTS env_status text,
  ADD COLUMN IF NOT EXISTS env_flag_reason text,
  ADD COLUMN IF NOT EXISTS adjacent_parcel_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS msa_distance_miles numeric;

CREATE INDEX IF NOT EXISTS idx_cpi_buyer_channel ON public.closing_pipeline_items (buyer_channel);
CREATE INDEX IF NOT EXISTS idx_cpi_zoning_category ON public.closing_pipeline_items (zoning_category);

CREATE OR REPLACE FUNCTION public.cpi_zoning_env_shield()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  z text := lower(coalesce(NEW.zoning_class, ''));
  a text := lower(coalesce(NEW.asset_type, ''));
  blob text;
BEGIN
  blob := z || ' ' || a || ' ' || lower(coalesce(NEW.title_notes,'')) || ' ' || lower(coalesce(NEW.address,''));

  -- 1. Zoning category
  IF blob ~ 'timber|forest|stumpage|woodland' THEN
    NEW.zoning_category := 'TIMBER';
  ELSIF blob ~ 'industrial|warehouse|logistics|flex|manufactur' THEN
    NEW.zoning_category := 'INDUSTRIAL';
  ELSIF blob ~ 'agricultur|farm|\bag\b|ranch|pasture' THEN
    NEW.zoning_category := 'AGRICULTURAL';
  ELSIF blob ~ 'multifamily|multi-family|btr|build-to-rent|high-density|apartment|mf\b' THEN
    NEW.zoning_category := 'MULTIFAMILY_BTR';
  ELSIF blob ~ 'commercial|retail|office|mixed-use|c-1|c-2|c1|c2' THEN
    NEW.zoning_category := 'COMMERCIAL';
  ELSIF blob ~ 'sfr|single-family|single family|r-1|r1|residential' THEN
    NEW.zoning_category := 'SFR';
  ELSE
    NEW.zoning_category := coalesce(NEW.zoning_category, 'UNZONED');
  END IF;

  -- 2. PE legislative shield
  IF NEW.zoning_category = 'SFR' THEN
    NEW.buyer_channel := 'local_cash_sdira';
    NEW.enrichment_tags := (
      SELECT array_agg(DISTINCT t) FROM unnest(
        array_remove(coalesce(NEW.enrichment_tags, '{}'), 'PE_CLEARANCE_APPROVED') || ARRAY['SFR-RETAIL-ONLY']
      ) t
    );
  ELSE
    NEW.buyer_channel := 'institutional_fund';
    NEW.enrichment_tags := (
      SELECT array_agg(DISTINCT t) FROM unnest(
        array_remove(coalesce(NEW.enrichment_tags, '{}'), 'SFR-RETAIL-ONLY') || ARRAY['PE_CLEARANCE_APPROVED']
      ) t
    );
  END IF;

  -- 3. EPA / UST pre-clearance
  IF blob ~ 'gas station|fuel|petroleum|underground storage|ust\b|brownfield|dry clean|landfill|superfund|contamina' THEN
    NEW.env_status := 'QUARANTINE_BROWNFIELD';
    NEW.env_flag_reason := 'Environmental history keyword detected in parcel record';
  ELSE
    NEW.env_status := 'ENV-CLEARED';
    NEW.env_flag_reason := NULL;
    NEW.enrichment_tags := (
      SELECT array_agg(DISTINCT t) FROM unnest(coalesce(NEW.enrichment_tags,'{}') || ARRAY['ENV-CLEARED']) t
    );
  END IF;

  -- 4. Daughter's timber dual-value matrix
  IF NEW.zoning_category = 'TIMBER'
     AND NEW.msa_distance_miles IS NOT NULL
     AND NEW.msa_distance_miles < 5 THEN
    NEW.enrichment_tags := (
      SELECT array_agg(DISTINCT t) FROM unnest(coalesce(NEW.enrichment_tags,'{}') || ARRAY['DUAL-YIELD']) t
    );
  END IF;

  -- 5. Assemblage neighbor count (same owner or same zip commercial lots)
  IF NEW.zoning_category <> 'SFR' THEN
    SELECT count(*) INTO NEW.adjacent_parcel_count
    FROM public.closing_pipeline_items c
    WHERE c.id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND c.zip IS NOT DISTINCT FROM NEW.zip
      AND (c.owner_entity IS NOT DISTINCT FROM NEW.owner_entity OR NEW.owner_entity IS NULL)
      AND coalesce(c.zoning_category,'') <> 'SFR'
      AND c.status NOT IN ('Closed','Dead');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_zoning_env_shield ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_zoning_env_shield
  BEFORE INSERT OR UPDATE OF zoning_class, asset_type, address, title_notes, msa_distance_miles
  ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_zoning_env_shield();

CREATE OR REPLACE FUNCTION public.commercial_assemblage_radar()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'channel_counts', (
      SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
        SELECT coalesce(buyer_channel,'unclassified') k, count(*) n
        FROM public.closing_pipeline_items
        WHERE status NOT IN ('Closed','Dead') GROUP BY 1
      ) s
    ),
    'zoning_counts', (
      SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
        SELECT coalesce(zoning_category,'UNZONED') k, count(*) n
        FROM public.closing_pipeline_items
        WHERE status NOT IN ('Closed','Dead') GROUP BY 1
      ) s
    ),
    'env_quarantined', (
      SELECT count(*) FROM public.closing_pipeline_items
      WHERE env_status = 'QUARANTINE_BROWNFIELD' AND status NOT IN ('Closed','Dead')
    ),
    'dual_yield', (
      SELECT count(*) FROM public.closing_pipeline_items
      WHERE 'DUAL-YIELD' = ANY(enrichment_tags) AND status NOT IN ('Closed','Dead')
    ),
    'clusters', (
      SELECT coalesce(jsonb_agg(c), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'zip', zip,
          'owner_entity', owner_entity,
          'zoning_category', zoning_category,
          'lot_count', count(*),
          'combined_basis', coalesce(sum(base_contract_price),0),
          'combined_fee', coalesce(sum(optimized_acquisition_premium),0),
          'combined_sqft', coalesce(sum(coalesce(lot_sqft, sqft, 0)),0)
        ) c
        FROM public.closing_pipeline_items
        WHERE status NOT IN ('Closed','Dead')
          AND coalesce(zoning_category,'') NOT IN ('SFR','')
        GROUP BY zip, owner_entity, zoning_category
        HAVING count(*) > 1
        ORDER BY sum(optimized_acquisition_premium) DESC NULLS LAST
        LIMIT 25
      ) x
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.cpi_zoning_env_shield() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commercial_assemblage_radar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_assemblage_radar() TO authenticated, service_role;
