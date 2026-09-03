
-- 1. Audit log table
CREATE TABLE IF NOT EXISTS public.system_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid,
  from_status text,
  to_status text,
  reason text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_audit_logs TO authenticated;
GRANT ALL ON public.system_audit_logs TO service_role;

ALTER TABLE public.system_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_audit_logs_admin_read"
  ON public.system_audit_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "system_audit_logs_service_write"
  ON public.system_audit_logs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_system_audit_logs_created_at
  ON public.system_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_item
  ON public.system_audit_logs (pipeline_item_id);

-- 2. Adversarial Auditor trigger function
CREATE OR REPLACE FUNCTION public.adversarial_audit_cpi()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text;
  v_allowed boolean := true;
BEGIN
  -- Only audit when status actually changes
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Deterministic state machine: valid transitions
  -- Scout         -> New, Rejected, Dead
  -- New           -> Locked-Escrow-Pending, House-Bid, Buyer-Signed, Rejected, Dead, Funds-Cleared
  -- Buyer-Signed  -> Locked-Escrow-Pending, Funds-Cleared, Dead, Rejected
  -- Locked-Escrow-Pending -> Funds-Cleared, Rejected, Dead
  -- House-Bid     -> New, Locked-Escrow-Pending, Rejected, Dead
  -- Funds-Cleared -> (terminal; cannot revert)
  -- Rejected      -> (terminal)
  -- Dead          -> (terminal)
  IF OLD.status IN ('Funds-Cleared','Rejected','Dead') THEN
    v_allowed := false;
    v_reason := format('Terminal status %s cannot transition', OLD.status);
  ELSIF OLD.status = 'Scout' AND NEW.status NOT IN ('New','Rejected','Dead') THEN
    v_allowed := false;
    v_reason := format('Invalid transition Scout -> %s', NEW.status);
  ELSIF OLD.status = 'New' AND NEW.status NOT IN ('Locked-Escrow-Pending','House-Bid','Buyer-Signed','Rejected','Dead','Funds-Cleared') THEN
    v_allowed := false;
    v_reason := format('Invalid transition New -> %s', NEW.status);
  ELSIF OLD.status = 'Buyer-Signed' AND NEW.status NOT IN ('Locked-Escrow-Pending','Funds-Cleared','Dead','Rejected') THEN
    v_allowed := false;
    v_reason := format('Invalid transition Buyer-Signed -> %s', NEW.status);
  ELSIF OLD.status = 'Locked-Escrow-Pending' AND NEW.status NOT IN ('Funds-Cleared','Rejected','Dead') THEN
    v_allowed := false;
    v_reason := format('Invalid transition Locked-Escrow-Pending -> %s', NEW.status);
  ELSIF OLD.status = 'House-Bid' AND NEW.status NOT IN ('New','Locked-Escrow-Pending','Rejected','Dead') THEN
    v_allowed := false;
    v_reason := format('Invalid transition House-Bid -> %s', NEW.status);
  END IF;

  -- Integrity: clearing requires a positive amount + assigned owner
  IF v_allowed AND NEW.status = 'Funds-Cleared' THEN
    IF COALESCE(NEW.cleared_amount, 0) <= 0 THEN
      v_allowed := false;
      v_reason := 'Integrity: cleared_amount must be > 0 on Funds-Cleared';
    ELSIF NEW.active_owner IS NULL THEN
      v_allowed := false;
      v_reason := 'Parity: active_owner not assigned at clearance';
    END IF;
  END IF;

  -- Parity: Tier-1 (fee >= 100k) must be routed to Master
  IF v_allowed
     AND COALESCE(NEW.optimized_acquisition_premium, 0) >= 100000
     AND NEW.active_owner IS NOT NULL
     AND NEW.active_owner <> 'Master' THEN
    v_allowed := false;
    v_reason := format('Parity: Tier-1 fee (%.2f) must route to Master, got %s',
                       NEW.optimized_acquisition_premium, NEW.active_owner);
  END IF;

  IF NOT v_allowed THEN
    INSERT INTO public.system_audit_logs
      (pipeline_item_id, from_status, to_status, reason, payload)
    VALUES
      (OLD.id, OLD.status, NEW.status, v_reason,
       jsonb_build_object(
         'cleared_amount', NEW.cleared_amount,
         'active_owner', NEW.active_owner,
         'fee', NEW.optimized_acquisition_premium
       ));

    INSERT INTO public.system_alerts (kind, severity, message, metadata)
    VALUES ('ADVERSARIAL_AUDIT_REJECT', 'high',
            format('Adversarial Audit Failed: %s', v_reason),
            jsonb_build_object('item_id', OLD.id, 'from', OLD.status, 'to', NEW.status));

    RAISE EXCEPTION 'Adversarial Audit Failed: %', v_reason
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_adversarial_audit ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_adversarial_audit
  BEFORE UPDATE OF status ON public.closing_pipeline_items
  FOR EACH ROW
  EXECUTE FUNCTION public.adversarial_audit_cpi();

-- 3. Telemetry Heartbeat: ledger checksum vs system_metrics
CREATE OR REPLACE FUNCTION public.telemetry_heartbeat()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ledger numeric;
  v_metric numeric;
BEGIN
  SELECT COALESCE(SUM(cleared_amount), 0)
    INTO v_ledger
  FROM public.closing_pipeline_items
  WHERE status = 'Funds-Cleared';

  SELECT COALESCE((value)::numeric, 0)
    INTO v_metric
  FROM public.system_metrics
  WHERE key = 'fees_cleared'
  LIMIT 1;

  IF abs(COALESCE(v_ledger,0) - COALESCE(v_metric,0)) > 0.01 THEN
    INSERT INTO public.system_alerts (kind, severity, message, metadata)
    VALUES ('STATE_DRIFT_ALERT', 'critical',
            format('Ledger/metrics drift: ledger=%.2f metric=%.2f', v_ledger, v_metric),
            jsonb_build_object('ledger', v_ledger, 'metric', v_metric, 'checked_at', now()));
    PERFORM public.refresh_system_metrics();
  END IF;
END;
$$;

-- Schedule heartbeat every minute (replace if exists)
DO $$
BEGIN
  PERFORM cron.unschedule('telemetry-heartbeat');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'telemetry-heartbeat',
  '* * * * *',
  $$SELECT public.telemetry_heartbeat();$$
);
