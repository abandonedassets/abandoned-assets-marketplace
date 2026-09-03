
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS escrow_pending_at timestamptz;

UPDATE public.closing_pipeline_items
  SET escrow_pending_at = locked_at
  WHERE escrow_pending_at IS NULL AND locked_at IS NOT NULL;

-- Stamp escrow_pending_at the moment status enters Locked-Escrow-Pending
CREATE OR REPLACE FUNCTION public.cpi_stamp_escrow_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'Locked-Escrow-Pending'::app_pipeline_status
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.escrow_pending_at IS NULL THEN
    NEW.escrow_pending_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_stamp_escrow_pending ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_stamp_escrow_pending
  BEFORE INSERT OR UPDATE ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_stamp_escrow_pending();

-- Protect escrow_pending_at from owner-side edits
CREATE OR REPLACE FUNCTION public.cpi_block_owner_sensitive_updates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR session_user = 'service_role'
     OR session_user = 'postgres' THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.escrow_status IS DISTINCT FROM OLD.escrow_status
     OR NEW.stripe_session_id IS DISTINCT FROM OLD.stripe_session_id
     OR NEW.stripe_session_url IS DISTINCT FROM OLD.stripe_session_url
     OR NEW.stripe_session_expires_at IS DISTINCT FROM OLD.stripe_session_expires_at
     OR NEW.cleared_at IS DISTINCT FROM OLD.cleared_at
     OR NEW.cleared_amount IS DISTINCT FROM OLD.cleared_amount
     OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
     OR NEW.locked_by_key_id IS DISTINCT FROM OLD.locked_by_key_id
     OR NEW.escrow_pending_at IS DISTINCT FROM OLD.escrow_pending_at
     OR NEW.matched_buyer_id IS DISTINCT FROM OLD.matched_buyer_id
     OR NEW.matched_buy_box_id IS DISTINCT FROM OLD.matched_buy_box_id
     OR NEW.spread_multiplier IS DISTINCT FROM OLD.spread_multiplier
     OR NEW.spread_score IS DISTINCT FROM OLD.spread_score
     OR NEW.auto_clearance_ready IS DISTINCT FROM OLD.auto_clearance_ready
     OR NEW.confidence_score IS DISTINCT FROM OLD.confidence_score
     OR NEW.manual_review IS DISTINCT FROM OLD.manual_review
     OR NEW.is_stale IS DISTINCT FROM OLD.is_stale
     OR NEW.stale_at IS DISTINCT FROM OLD.stale_at
     OR NEW.is_held IS DISTINCT FROM OLD.is_held
     OR NEW.held_until IS DISTINCT FROM OLD.held_until
     OR NEW.bundle_id IS DISTINCT FROM OLD.bundle_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.escrow_doc_path IS DISTINCT FROM OLD.escrow_doc_path
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.external_id IS DISTINCT FROM OLD.external_id
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.sovereign_override IS DISTINCT FROM OLD.sovereign_override
     OR NEW.sovereign_override_at IS DISTINCT FROM OLD.sovereign_override_at
     OR NEW.clear_retry_count IS DISTINCT FROM OLD.clear_retry_count
     OR NEW.requires_legal_review IS DISTINCT FROM OLD.requires_legal_review THEN
    RAISE EXCEPTION 'OWNER_CANNOT_MODIFY_OPERATIONAL_FIELDS'
      USING ERRCODE = '42501',
            HINT = 'Use server-side RPCs to change operational state.';
  END IF;
  RETURN NEW;
END;
$$;

-- CVI metrics RPC
CREATE OR REPLACE FUNCTION public.cvi_metrics()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT cleared_at,
           EXTRACT(EPOCH FROM (cleared_at - escrow_pending_at))/3600.0 AS hours
    FROM public.closing_pipeline_items
    WHERE cleared_at IS NOT NULL
      AND escrow_pending_at IS NOT NULL
      AND cleared_at >= now() - interval '14 days'
      AND cleared_at > escrow_pending_at
  ),
  cur AS (SELECT AVG(hours) a, COUNT(*) c FROM base WHERE cleared_at >= now() - interval '7 days'),
  prev AS (SELECT AVG(hours) a, COUNT(*) c FROM base WHERE cleared_at < now() - interval '7 days' AND cleared_at >= now() - interval '14 days'),
  days AS (
    SELECT gs::date AS d FROM generate_series((now() - interval '6 days')::date, now()::date, interval '1 day') gs
  ),
  daily AS (
    SELECT d.d AS day,
           COALESCE(AVG(b.hours), 0) AS avg_hours,
           COUNT(b.hours) AS n
    FROM days d
    LEFT JOIN base b ON date_trunc('day', b.cleared_at)::date = d.d
    GROUP BY d.d
    ORDER BY d.d
  )
  SELECT jsonb_build_object(
    'current_avg_hours', COALESCE((SELECT a FROM cur), 0),
    'current_sample', COALESCE((SELECT c FROM cur), 0),
    'previous_avg_hours', COALESCE((SELECT a FROM prev), 0),
    'previous_sample', COALESCE((SELECT c FROM prev), 0),
    'daily', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'avg_hours', avg_hours, 'n', n)) FROM daily), '[]'::jsonb),
    'generated_at', now()
  );
$$;

GRANT EXECUTE ON FUNCTION public.cvi_metrics() TO authenticated, service_role;
