
-- 1. Canonical fee formula in SQL (mirrors county-ingest + cognitive-ingest TS)
CREATE OR REPLACE FUNCTION public.compute_assignment_fee(_price numeric, _arv numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _floor numeric := 5000;
  _cap   numeric := 500000;
  _pct   numeric;
  _tiered numeric;
  _spread numeric;
  _price numeric := COALESCE(_price, 0);
BEGIN
  IF _price <= 0 THEN RETURN _floor; END IF;
  IF _price < 100000 THEN _pct := 0.05;
  ELSIF _price < 500000 THEN _pct := 0.04;
  ELSIF _price < 2000000 THEN _pct := 0.03;
  ELSE _pct := 0.025;
  END IF;
  _tiered := round(_price * _pct);
  _spread := CASE WHEN _arv IS NOT NULL AND _arv > _price
                  THEN round((_arv - _price) * 0.10)
                  ELSE 0 END;
  RETURN LEAST(GREATEST(_floor, _tiered, _spread), _cap);
END;
$$;

-- 2. Backfill stuck rows: premium exactly 5000 on non-trivial base prices,
-- pre-clearance only (never rewrite cleared/closed/dead capital).
UPDATE public.closing_pipeline_items
SET optimized_acquisition_premium = public.compute_assignment_fee(base_contract_price, NULL),
    updated_at = now()
WHERE optimized_acquisition_premium = 5000
  AND base_contract_price >= 50000
  AND status::text NOT IN ('Funds-Cleared','Closed','Dead','CRITICAL_STALL');

-- 3. Terminal-phase telemetry: alert when an item lands in dead_letter or System-Hold
CREATE OR REPLACE FUNCTION public.alert_terminal_failure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.escrow_status = 'dead_letter' OR NEW.status::text = 'System-Hold')
     AND (TG_OP = 'INSERT'
          OR OLD.escrow_status IS DISTINCT FROM NEW.escrow_status
          OR OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.system_alerts(severity, kind, message, deal_id, metadata)
    VALUES ('high', 'TERMINAL_FAILURE_ALERT',
      'Terminal-phase failure: asset isolated in dead-letter / system-hold. Payout payload halted to protect downstream Stripe sequence.',
      NEW.id,
      jsonb_build_object(
        'zip', NEW.zip,
        'base_contract_price', NEW.base_contract_price,
        'optimized_acquisition_premium', NEW.optimized_acquisition_premium,
        'escrow_status', NEW.escrow_status,
        'status', NEW.status,
        'clear_retry_count', NEW.clear_retry_count
      ));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_terminal_failure ON public.closing_pipeline_items;
CREATE TRIGGER trg_alert_terminal_failure
AFTER INSERT OR UPDATE ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.alert_terminal_failure();
