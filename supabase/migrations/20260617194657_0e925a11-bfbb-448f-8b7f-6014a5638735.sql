
-- ============================================================
-- Institutional Capital Aggregation & Assemblage Engine
-- All enrichment is fail-forward: errors log DATA_ENRICHMENT_WARNING
-- and never block clearing.
-- ============================================================

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS apn text,
  ADD COLUMN IF NOT EXISTS owner_entity text,
  ADD COLUMN IF NOT EXISTS owner_acquired_at timestamptz,
  ADD COLUMN IF NOT EXISTS annual_property_tax numeric(14,2),
  ADD COLUMN IF NOT EXISTS lien_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS assessed_value numeric(14,2),
  ADD COLUMN IF NOT EXISTS zoning_class text,
  ADD COLUMN IF NOT EXISTS lot_sqft integer,
  ADD COLUMN IF NOT EXISTS assemblage_group_id uuid,
  ADD COLUMN IF NOT EXISTS enrichment_tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS days_owned integer,
  ADD COLUMN IF NOT EXISTS tax_burden_ratio numeric;

CREATE INDEX IF NOT EXISTS idx_cpi_enrichment_tags ON public.closing_pipeline_items USING GIN (enrichment_tags);
CREATE INDEX IF NOT EXISTS idx_cpi_assemblage_group ON public.closing_pipeline_items (assemblage_group_id) WHERE assemblage_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cpi_owner_entity_zip ON public.closing_pipeline_items (lower(owner_entity), zip) WHERE owner_entity IS NOT NULL;

-- Allow these new informational fields to be updated by owner role
-- (they are NOT in the cpi_block_owner_sensitive_updates list, so already OK).

-- ============================================================
-- Enrichment function: 1031, low-EMD, commercial-infill tags
-- Fully wrapped: any failure logs DATA_ENRICHMENT_WARNING and returns NEW.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cpi_enrich_capital_tags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tags text[] := COALESCE(NEW.enrichment_tags, '{}'::text[]);
  _days integer;
  _ratio numeric;
  _zoning text;
BEGIN
  BEGIN
    -- Strip existing capital tags so we recompute clean
    _tags := ARRAY(SELECT unnest(_tags) EXCEPT SELECT unnest(ARRAY[
      '1031-TARGET','LOW-EMD-ELIGIBLE','COMMERCIAL-INFILL','ASSEMBLAGE-OPPORTUNITY'
    ]));

    -- (1) 1031-TARGET: held > 365 days
    IF NEW.owner_acquired_at IS NOT NULL THEN
      _days := GREATEST(0, EXTRACT(DAY FROM (now() - NEW.owner_acquired_at))::int);
      NEW.days_owned := _days;
      IF _days > 365 THEN
        _tags := array_append(_tags, '1031-TARGET');
      END IF;
    END IF;

    -- (2) LOW-EMD-ELIGIBLE: tax burden ratio
    IF NEW.assessed_value IS NOT NULL AND NEW.assessed_value > 0 THEN
      _ratio := (COALESCE(NEW.annual_property_tax,0) + COALESCE(NEW.lien_total,0))
                / NULLIF(NEW.assessed_value,0);
      NEW.tax_burden_ratio := _ratio;
      IF _ratio >= 0.08 THEN
        _tags := array_append(_tags, 'LOW-EMD-ELIGIBLE');
      END IF;
    END IF;

    -- (3) COMMERCIAL-INFILL: upzoning-friendly zoning classes
    _zoning := lower(COALESCE(NEW.zoning_class,''));
    IF _zoning ~ '(adu|mixed|multi|mf|commercial|c-?[12]|r-?[34]|infill|upzone)' THEN
      _tags := array_append(_tags, 'COMMERCIAL-INFILL');
    END IF;

    NEW.enrichment_tags := ARRAY(SELECT DISTINCT unnest(_tags));
  EXCEPTION WHEN OTHERS THEN
    -- Graceful degrade: never block the deal
    BEGIN
      INSERT INTO public.system_alerts(severity, kind, message, deal_id, metadata)
      VALUES ('low','DATA_ENRICHMENT_WARNING',
        'Capital-tag enrichment bypassed: ' || SQLERRM,
        NEW.id,
        jsonb_build_object('zip', NEW.zip, 'apn', NEW.apn, 'sqlstate', SQLSTATE));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_enrich_capital_tags ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_enrich_capital_tags
BEFORE INSERT OR UPDATE OF owner_acquired_at, annual_property_tax, lien_total, assessed_value, zoning_class
ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.cpi_enrich_capital_tags();

-- ============================================================
-- Assemblage Radar: group adjacent / same-owner vacant lots
-- ============================================================
CREATE OR REPLACE FUNCTION public.detect_assemblage_groups()
RETURNS TABLE(group_id uuid, deal_count integer, combined_sqft bigint, owner_entity text, zip text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _r RECORD; _gid uuid; _tags text[];
BEGIN
  -- Group by (lower(owner_entity), zip) where 2+ active lots exist.
  -- APN-prefix adjacency is a secondary signal: same first 8 chars of APN.
  FOR _r IN
    SELECT lower(owner_entity) AS oe, zip,
           ARRAY_AGG(id) AS ids,
           SUM(COALESCE(lot_sqft,0))::bigint AS sqft_total,
           COUNT(*) AS n,
           MAX(owner_entity) AS oe_display
    FROM public.closing_pipeline_items
    WHERE owner_entity IS NOT NULL
      AND status::text NOT IN ('Closed','Dead','CRITICAL_STALL')
      AND COALESCE(is_held,false) = false
    GROUP BY lower(owner_entity), zip
    HAVING COUNT(*) >= 2
  LOOP
    _gid := gen_random_uuid();
    UPDATE public.closing_pipeline_items
      SET assemblage_group_id = _gid,
          enrichment_tags = ARRAY(
            SELECT DISTINCT unnest(COALESCE(enrichment_tags,'{}'::text[]) || ARRAY['ASSEMBLAGE-OPPORTUNITY'])
          ),
          updated_at = now()
      WHERE id = ANY(_r.ids)
        AND (assemblage_group_id IS DISTINCT FROM _gid
             OR NOT ('ASSEMBLAGE-OPPORTUNITY' = ANY(COALESCE(enrichment_tags,'{}'::text[]))));
    group_id := _gid;
    deal_count := _r.n::int;
    combined_sqft := _r.sqft_total;
    owner_entity := _r.oe_display;
    zip := _r.zip;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ============================================================
-- Read API for the Assemblage Radar dashboard widget
-- ============================================================
CREATE OR REPLACE FUNCTION public.assemblage_radar_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH groups AS (
    SELECT assemblage_group_id AS group_id,
           MAX(owner_entity) AS owner_entity,
           MAX(zip) AS zip,
           COUNT(*) AS deal_count,
           SUM(COALESCE(lot_sqft,0))::bigint AS combined_sqft,
           SUM(COALESCE(base_contract_price,0))::numeric AS combined_basis,
           SUM(COALESCE(optimized_acquisition_premium,0))::numeric AS combined_fee
    FROM public.closing_pipeline_items
    WHERE assemblage_group_id IS NOT NULL
      AND status::text NOT IN ('Closed','Dead','CRITICAL_STALL')
    GROUP BY assemblage_group_id
    ORDER BY combined_sqft DESC NULLS LAST
    LIMIT 20
  ),
  tag_counts AS (
    SELECT tag, COUNT(*) AS n FROM (
      SELECT unnest(enrichment_tags) AS tag
      FROM public.closing_pipeline_items
      WHERE status::text NOT IN ('Closed','Dead','CRITICAL_STALL')
    ) t
    WHERE tag IN ('1031-TARGET','LOW-EMD-ELIGIBLE','COMMERCIAL-INFILL','ASSEMBLAGE-OPPORTUNITY')
    GROUP BY tag
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'groups', COALESCE((SELECT jsonb_agg(to_jsonb(groups.*)) FROM groups), '[]'::jsonb),
    'tag_counts', COALESCE((SELECT jsonb_object_agg(tag, n) FROM tag_counts), '{}'::jsonb)
  );
$$;
