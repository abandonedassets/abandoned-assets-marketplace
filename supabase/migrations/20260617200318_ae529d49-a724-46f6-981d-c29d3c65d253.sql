
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS emd_amount numeric,
  ADD COLUMN IF NOT EXISTS emd_tier text;

CREATE OR REPLACE FUNCTION public.compute_emd_amount(_price numeric, _tags text[])
RETURNS TABLE(emd_amount numeric, emd_tier text)
LANGUAGE plpgsql IMMUTABLE
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
    emd_amount := LEAST(25000, GREATEST(1000, ROUND(_p * 0.01)));
    emd_tier := 'STANDARD';
  END IF;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.cpi_stamp_emd()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _r record;
BEGIN
  BEGIN
    SELECT * INTO _r FROM public.compute_emd_amount(NEW.base_contract_price, NEW.enrichment_tags);
    NEW.emd_amount := _r.emd_amount;
    NEW.emd_tier := _r.emd_tier;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.system_alerts(severity, kind, message, deal_id, metadata)
      VALUES ('low','EMD_STAMP_WARNING','EMD stamping bypassed: ' || SQLERRM, NEW.id,
        jsonb_build_object('zip', NEW.zip, 'sqlstate', SQLSTATE));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_stamp_emd ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_stamp_emd
  BEFORE INSERT OR UPDATE OF base_contract_price, enrichment_tags
  ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_stamp_emd();

-- Backfill via subquery (avoids LATERAL scoping issue)
UPDATE public.closing_pipeline_items c
SET emd_amount = sub.emd_amount,
    emd_tier   = sub.emd_tier,
    updated_at = now()
FROM (
  SELECT id,
         (public.compute_emd_amount(base_contract_price, enrichment_tags)).emd_amount,
         (public.compute_emd_amount(base_contract_price, enrichment_tags)).emd_tier
  FROM public.closing_pipeline_items
) sub
WHERE c.id = sub.id
  AND (c.emd_amount IS DISTINCT FROM sub.emd_amount
       OR c.emd_tier IS DISTINCT FROM sub.emd_tier);
