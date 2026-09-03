ALTER TYPE public.app_pipeline_status ADD VALUE IF NOT EXISTS 'Pending-Underwriting';

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS estimated_repairs numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contract_state text NOT NULL DEFAULT 'UNSENT';

CREATE OR REPLACE FUNCTION public.compute_assignment_fee(p_arv numeric, p_repairs numeric, p_offer numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE _fee numeric;
BEGIN
  IF p_arv IS NULL OR p_arv <= 0 OR p_offer IS NULL OR p_offer <= 0 THEN
    RETURN NULL; -- no valuation => pending underwriting, never a mock fee
  END IF;
  _fee := (p_arv * 0.70) - COALESCE(p_repairs, 0) - p_offer;
  IF _fee IS NULL OR _fee <= 0 THEN RETURN 0; END IF;
  RETURN LEAST(round(_fee), 500000);
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_assignment_fee(_price numeric, _arv numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN COALESCE(public.compute_assignment_fee(_arv, 0, _price), 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.cpi_autoprice_premium()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _fee numeric;
BEGIN
  _fee := public.compute_assignment_fee(NEW.assessed_value, COALESCE(NEW.estimated_repairs, 0), NEW.base_contract_price);
  IF _fee IS NULL THEN
    NEW.optimized_acquisition_premium := 0;
    IF NEW.status IN ('New','Scout') THEN
      NEW.status := 'Pending-Underwriting';
    END IF;
  ELSE
    NEW.optimized_acquisition_premium := _fee;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cpi_dynamic_spread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW; -- superseded by live ARV math in cpi_autoprice_premium
END;
$$;

CREATE INDEX IF NOT EXISTS idx_cpi_contract_state ON public.closing_pipeline_items (contract_state);