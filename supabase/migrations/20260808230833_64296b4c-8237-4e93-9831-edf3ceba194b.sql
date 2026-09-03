CREATE OR REPLACE FUNCTION public.cpi_set_confidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _base integer;
  _bonus integer := 0;
  _equity numeric;
  _institutional boolean := false;
BEGIN
  IF NEW.base_contract_price IS NOT NULL THEN
    _base := public.compute_confidence_score(NEW.zip, NEW.base_contract_price);

    IF COALESCE(NEW.assessed_value,0) > 0 AND NEW.base_contract_price > 0 THEN
      _equity := 1 - (NEW.base_contract_price / NEW.assessed_value);
      IF _equity >= 0.30 THEN _bonus := _bonus + 25;
      ELSIF _equity >= 0.15 THEN _bonus := _bonus + 15;
      END IF;
    END IF;

    IF COALESCE(NEW.optimized_acquisition_premium,0) >= 25000 THEN _bonus := _bonus + 15;
    ELSIF COALESCE(NEW.optimized_acquisition_premium,0) >= 10000 THEN _bonus := _bonus + 8;
    END IF;

    IF NEW.zip IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.buyer_buy_boxes b
      WHERE b.active AND NEW.zip = ANY(b.target_zip_codes)
    ) THEN _bonus := _bonus + 20;
    END IF;
    IF COALESCE(NEW.msa_distance_miles, 999) <= 25 THEN _bonus := _bonus + 5; END IF;

    IF NEW.priority_override OR NEW.sovereign_override THEN _bonus := _bonus + 50; END IF;

    NEW.confidence_score := LEAST(100, GREATEST(0, _base + _bonus));

    -- Institutional-ready floor: 70% ARV gate assets with clean title never
    -- fall into rejection because of ZIP-level base scoring.
    _institutional := COALESCE('INSTITUTIONAL_READY' = ANY(NEW.enrichment_tags), false)
      OR COALESCE('TITLE_PURE' = ANY(NEW.enrichment_tags), false)
      OR (
        COALESCE(NEW.assessed_value,0) > 0
        AND NEW.base_contract_price > 0
        AND (NEW.base_contract_price / NEW.assessed_value) <= 0.70
        AND COALESCE(NEW.title_status::text, 'Pending') = 'Insured'
        AND COALESCE(NEW.requires_legal_review, false) = false
      );

    IF _institutional THEN
      NEW.confidence_score := GREATEST(COALESCE(NEW.confidence_score,0), 85);
    END IF;

    NEW.manual_review := COALESCE(NEW.confidence_score, 0) < 50;
  END IF;
  RETURN NEW;
END;
$function$;

INSERT INTO public.institutional_api_keys (label, key_hash, key_prefix, is_active, rate_limit_per_minute)
SELECT 'E2E SYSTEM PROBE KEY', 'd0bde8f5b326b36eeb67136ef951c7b8a74dd49aa18ebc97250c98274bb0b5cd', 'pk_e2e', true, 600
WHERE NOT EXISTS (
  SELECT 1 FROM public.institutional_api_keys
  WHERE key_hash = 'd0bde8f5b326b36eeb67136ef951c7b8a74dd49aa18ebc97250c98274bb0b5cd'
);