-- 1. Conversion telemetry store
CREATE TABLE IF NOT EXISTS public.conversion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  pipeline_item_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE SET NULL,
  buyer_email text,
  channel text,
  user_agent text,
  referer text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.conversion_events TO authenticated;
GRANT ALL ON public.conversion_events TO service_role;
ALTER TABLE public.conversion_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read conversion events" ON public.conversion_events;
CREATE POLICY "admins read conversion events" ON public.conversion_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS conversion_events_created_idx ON public.conversion_events (created_at DESC);
CREATE INDEX IF NOT EXISTS conversion_events_item_idx ON public.conversion_events (pipeline_item_id);

-- 2. Silence known-benign DLQ noise (dedupe + low-confidence) at the alert source
CREATE OR REPLACE FUNCTION public.dlq_emit_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _reason text := COALESCE(NEW.error_reason, 'unknown_dlq_error');
BEGIN
  IF _reason ILIKE '%duplicate key value%'
     OR _reason ILIKE '%closing_pipeline_items_zip_address_uniq%'
     OR _reason ILIKE '%low_confidence_auto_reject%'
     OR _reason ILIKE '%datafiniti%' THEN
    RETURN NEW; -- log silently, no dashboard alert
  END IF;
  BEGIN
    INSERT INTO public.system_alerts(severity, kind, message, metadata)
    VALUES ('high','dlq_anomaly', _reason,
      jsonb_build_object('source_ip', NEW.source_ip, 'dlq_id', NEW.id, 'created_at', NEW.created_at));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$$;

-- 3. Targeted scoring weights: floor stays at 50, but high-margin / equity /
--    location signals add weight so premium assets clear the gate.
CREATE OR REPLACE FUNCTION public.cpi_set_confidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _base integer;
  _bonus integer := 0;
  _equity numeric;
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
    NEW.manual_review := COALESCE(NEW.confidence_score, 0) < 50;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_confidence ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_confidence
  BEFORE INSERT OR UPDATE OF base_contract_price ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_set_confidence();