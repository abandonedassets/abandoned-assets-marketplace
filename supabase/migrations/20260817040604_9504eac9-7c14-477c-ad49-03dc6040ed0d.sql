CREATE OR REPLACE FUNCTION public.cpi_classify_geo_asset()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  txt text;
BEGIN
  txt := lower(coalesce(NEW.city,'') || ' ' || coalesce(NEW.county,'') || ' ' || coalesce(NEW.address,'') || ' ' ||
                coalesce(NEW.asset_type,'') || ' ' || coalesce(NEW.zoning_category,'') || ' ' ||
                coalesce(array_to_string(NEW.enrichment_tags,' '),''));

  -- Muncie, Indiana normalization
  IF txt ~ 'muncie' THEN
    IF NEW.city IS NULL OR lower(NEW.city) <> 'muncie' THEN NEW.city := 'Muncie'; END IF;
    IF NEW.state IS NULL THEN NEW.state := 'IN'; END IF;
    IF NOT ('MUNCIE_IN' = ANY(coalesce(NEW.enrichment_tags, ARRAY[]::text[]))) THEN
      NEW.enrichment_tags := coalesce(NEW.enrichment_tags, ARRAY[]::text[]) || 'MUNCIE_IN';
    END IF;
  END IF;

  -- Timber detection
  IF NEW.has_timber IS NOT TRUE AND (txt ~ '(timber|stumpage|logging|sawmill|mbf)' OR coalesce(NEW.estimated_stumpage_mbf,0) > 0) THEN
    NEW.has_timber := true;
  END IF;

  -- Asset class
  IF NEW.asset_class IS NULL OR NEW.asset_class = '' THEN
    IF NEW.has_timber THEN
      NEW.asset_class := 'timber';
    ELSIF txt ~ '(raw land|vacant land|\mland\M|lot|acreage|modular|manufactured|mobile home)' THEN
      NEW.asset_class := 'land';
    ELSE
      NEW.asset_class := 'residential';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_classify_geo_asset ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_classify_geo_asset
BEFORE INSERT OR UPDATE OF city, county, address, asset_type, zoning_category, enrichment_tags, estimated_stumpage_mbf
ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.cpi_classify_geo_asset();