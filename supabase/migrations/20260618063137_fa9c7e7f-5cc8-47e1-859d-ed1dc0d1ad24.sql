
-- 1. Auto-pricing trigger: recompute optimized_acquisition_premium on insert / price change.
CREATE OR REPLACE FUNCTION public.cpi_autoprice_premium()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _computed numeric;
BEGIN
  -- Only act when we have a real contract price.
  IF NEW.base_contract_price IS NULL OR NEW.base_contract_price <= 0 THEN
    RETURN NEW;
  END IF;

  -- Recompute when: brand-new row, price changed, or premium is the
  -- classic $5,000 placeholder / null / zero.
  IF TG_OP = 'INSERT'
     OR NEW.base_contract_price IS DISTINCT FROM OLD.base_contract_price
     OR NEW.optimized_acquisition_premium IS NULL
     OR NEW.optimized_acquisition_premium <= 0
     OR NEW.optimized_acquisition_premium = 5000 THEN
    BEGIN
      _computed := public.compute_assignment_fee(
        NEW.base_contract_price,
        NEW.assessed_value
      );
      IF _computed IS NOT NULL AND _computed > 0 THEN
        NEW.optimized_acquisition_premium := _computed;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Fail-forward: never block ingestion on pricing.
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_autoprice_premium ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_autoprice_premium
BEFORE INSERT OR UPDATE OF base_contract_price, assessed_value
ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.cpi_autoprice_premium();

-- 2. Backfill: recompute every asset currently parked at the $5,000 placeholder
--    or NULL premium, so the dashboard breaks out of stasis immediately.
UPDATE public.closing_pipeline_items
SET optimized_acquisition_premium = public.compute_assignment_fee(
      base_contract_price, assessed_value
    ),
    updated_at = now()
WHERE base_contract_price IS NOT NULL
  AND base_contract_price > 0
  AND (
    optimized_acquisition_premium IS NULL
    OR optimized_acquisition_premium <= 0
    OR optimized_acquisition_premium = 5000
  )
  AND status::text NOT IN ('Funds-Cleared','Closed','Dead','CRITICAL_STALL');
