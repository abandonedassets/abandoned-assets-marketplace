ALTER TABLE public.buyer_buy_boxes
  ADD COLUMN IF NOT EXISTS settlement_velocity_score NUMERIC(5,2) DEFAULT 50.00,
  ADD COLUMN IF NOT EXISTS total_completed_wires INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_claimed_locks INT DEFAULT 0;

ALTER TABLE public.dlq_events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';

CREATE INDEX IF NOT EXISTS idx_dlq_pending_retry
  ON public.dlq_events (next_retry_at)
  WHERE status = 'PENDING' AND resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_strike_lookup
  ON public.closing_pipeline_items (zip, base_contract_price)
  WHERE reverse_strike_ready = true;

CREATE TABLE IF NOT EXISTS public.system_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'ERROR',
  message TEXT NOT NULL,
  stack TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  alerted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_error_logs TO authenticated;
GRANT ALL ON public.system_error_logs TO service_role;
ALTER TABLE public.system_error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read system error logs" ON public.system_error_logs;
CREATE POLICY "Admins read system error logs"
  ON public.system_error_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_system_error_logs_recent
  ON public.system_error_logs (created_at DESC);

CREATE OR REPLACE FUNCTION public.self_heal_pipeline()
RETURNS TABLE(action_taken TEXT, items_repaired INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_locks INT := 0;
  v_stuck_leads INT := 0;
  v_recovered_endpoints INT := 0;
BEGIN
  UPDATE public.closing_pipeline_items
  SET m2m_expires_at = NULL, reverse_strike_ready = true
  WHERE m2m_expires_at IS NOT NULL AND m2m_expires_at < now();
  GET DIAGNOSTICS v_expired_locks = ROW_COUNT;

  UPDATE public.closing_pipeline_items
  SET status = 'Auto_Archived_Bad_Data'::app_pipeline_status
  WHERE status = 'Auto-Enrichment-Pending'::app_pipeline_status
    AND created_at < now() - INTERVAL '1 hour';
  GET DIAGNOSTICS v_stuck_leads = ROW_COUNT;

  UPDATE public.buyer_buy_boxes
  SET endpoint_status = 'healthy'
  WHERE endpoint_status = 'circuit_open'
    AND updated_at < now() - INTERVAL '30 minutes';
  GET DIAGNOSTICS v_recovered_endpoints = ROW_COUNT;

  RETURN QUERY VALUES
    ('Released Orphaned Expiry Locks', v_expired_locks),
    ('Purged Stuck Preflight Leads', v_stuck_leads),
    ('Reset Circuit-Broken Endpoints', v_recovered_endpoints);
END;
$$;

REVOKE ALL ON FUNCTION public.self_heal_pipeline() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.self_heal_pipeline() TO service_role;