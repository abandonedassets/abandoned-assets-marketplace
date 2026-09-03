CREATE OR REPLACE FUNCTION public.compute_emd_amount(_price numeric, _tags text[])
RETURNS TABLE(emd_amount numeric, emd_tier text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _p numeric := COALESCE(_price, 0);
  _low boolean := _tags IS NOT NULL AND 'LOW-EMD-ELIGIBLE' = ANY(_tags);
BEGIN
  IF _low THEN
    emd_amount := LEAST(500, GREATEST(100, ROUND(_p * 0.001)));
    emd_tier := 'LOW-EMD';
  ELSE
    -- Flat $1,000 to exactly match the Sign-3 Stripe ACH hold.
    emd_amount := 1000;
    emd_tier := 'STANDARD';
  END IF;
  RETURN NEXT;
END;
$$;