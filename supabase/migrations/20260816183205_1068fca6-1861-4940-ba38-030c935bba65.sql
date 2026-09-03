CREATE OR REPLACE FUNCTION public.cpi_stamp_m2m_fidelity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  s numeric := 0.5;
BEGIN
  IF NEW.apn IS NOT NULL AND length(NEW.apn) > 3 THEN s := s + 0.25; END IF;
  IF NEW.has_signed_marketing_auth THEN s := s + 0.2; END IF;
  IF NEW.owner_entity IS NOT NULL THEN s := s + 0.05; END IF;
  IF NEW.assessed_value IS NOT NULL AND NEW.assessed_value > 0 THEN s := s + 0.05; END IF;
  IF NEW.title_status = 'Insured'::title_status_enum THEN s := s + 0.05; END IF;
  IF NEW.source = 'manual' THEN s := s - 0.1; END IF;
  NEW.data_fidelity_score := LEAST(1.00, GREATEST(0.00, round(s, 2)));

  NEW.m2m_asset_hash := encode(extensions.digest(
    coalesce(NEW.apn, coalesce(NEW.address,'') || '|' || coalesce(NEW.zip,'')) || '|' ||
    coalesce(NEW.base_contract_price, 0)::text || '|' ||
    coalesce(NEW.has_signed_marketing_auth, false)::text, 'sha256'), 'hex');
  RETURN NEW;
END;
$function$;