ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS wire_instructed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS earnest_hold_status TEXT DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS lock_phase TEXT;

CREATE INDEX IF NOT EXISTS idx_cpi_lock_phase ON public.closing_pipeline_items (lock_phase) WHERE lock_phase IS NOT NULL;

CREATE OR REPLACE FUNCTION public.self_heal_pipeline()
RETURNS TABLE(action_taken text, items_repaired integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expired_locks INT := 0;
  v_wire_expired INT := 0;
  v_stuck_leads INT := 0;
  v_recovered_endpoints INT := 0;
BEGIN
  -- A. Release only soft holds (STRIKE_CLAIMED / unphased) past expiry.
  UPDATE public.closing_pipeline_items
  SET m2m_expires_at = NULL, reverse_strike_ready = true, lock_phase = NULL
  WHERE m2m_expires_at IS NOT NULL
    AND m2m_expires_at < now()
    AND coalesce(lock_phase, 'STRIKE_CLAIMED') <> 'WIRE_IN_FLIGHT';
  GET DIAGNOSTICS v_expired_locks = ROW_COUNT;

  -- B. Wire-in-flight deals are protected for a full 24h banking window.
  UPDATE public.closing_pipeline_items
  SET m2m_expires_at = NULL, reverse_strike_ready = true, lock_phase = NULL
  WHERE lock_phase = 'WIRE_IN_FLIGHT'
    AND cleared_at IS NULL
    AND coalesce(wire_instructed_at, now()) < now() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_wire_expired = ROW_COUNT;

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
    ('Released Expired Wire Windows', v_wire_expired),
    ('Purged Stuck Preflight Leads', v_stuck_leads),
    ('Reset Circuit-Broken Endpoints', v_recovered_endpoints);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_wire_in_flight(_deal_id uuid)
RETURNS TABLE(deal_id uuid, lock_phase text, wire_instructed_at timestamptz, m2m_expires_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.closing_pipeline_items
  SET lock_phase = 'WIRE_IN_FLIGHT',
      wire_instructed_at = coalesce(wire_instructed_at, now()),
      m2m_expires_at = coalesce(wire_instructed_at, now()) + INTERVAL '24 hours'
  WHERE id = _deal_id AND cleared_at IS NULL
  RETURNING id, lock_phase, wire_instructed_at, m2m_expires_at;
$function$;

REVOKE ALL ON FUNCTION public.mark_wire_in_flight(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_wire_in_flight(uuid) TO service_role;