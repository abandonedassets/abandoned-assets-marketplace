
CREATE OR REPLACE FUNCTION public.compute_assignment_fee(_price numeric, _arv numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _floor numeric;
  _cap   numeric := 500000;
  _pct   numeric;
  _tiered numeric;
  _spread numeric;
  _p numeric := COALESCE(_price, 0);
BEGIN
  IF _p <= 0 THEN RETURN 0; END IF;

  -- Dynamic floor scales with the asset: $250 minimum, max $5,000.
  -- A $3,000 lot floors at $250; a $200k lot floors at $5,000.
  _floor := LEAST(5000, GREATEST(250, ROUND(_p * 0.025)));

  IF _p < 100000 THEN _pct := 0.05;
  ELSIF _p < 500000 THEN _pct := 0.04;
  ELSIF _p < 2000000 THEN _pct := 0.03;
  ELSE _pct := 0.025;
  END IF;
  _tiered := round(_p * _pct);

  _spread := CASE WHEN _arv IS NOT NULL AND _arv > _p
                  THEN round((_arv - _p) * 0.10)
                  ELSE 0 END;

  RETURN LEAST(GREATEST(_floor, _tiered, _spread), _cap);
END;
$$;

-- Re-backfill every non-terminal asset so the dashboard breaks stasis.
UPDATE public.closing_pipeline_items
SET optimized_acquisition_premium = public.compute_assignment_fee(
      base_contract_price, assessed_value
    ),
    updated_at = now()
WHERE base_contract_price IS NOT NULL
  AND base_contract_price > 0
  AND status::text NOT IN ('Funds-Cleared','Closed','Dead','CRITICAL_STALL');
