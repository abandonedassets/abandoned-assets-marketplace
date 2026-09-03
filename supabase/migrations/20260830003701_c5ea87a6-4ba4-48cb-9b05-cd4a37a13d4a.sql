-- 1. Dead-letter vault for outbound buyer dispatch failures
CREATE TABLE IF NOT EXISTS public.dlq_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'm2m_dispatch',
  deal_id uuid,
  box_id uuid,
  endpoint text,
  http_status integer,
  error_text text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dlq_events TO authenticated;
GRANT ALL ON public.dlq_events TO service_role;
ALTER TABLE public.dlq_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dlq_admin_read" ON public.dlq_events;
CREATE POLICY "dlq_admin_read" ON public.dlq_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_dlq_events_retry
  ON public.dlq_events (next_retry_at) WHERE resolved_at IS NULL;

CREATE TRIGGER trg_dlq_events_updated_at
  BEFORE UPDATE ON public.dlq_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Hot-path indexes for the dispatch scan / lock sweeps
CREATE INDEX IF NOT EXISTS idx_cpi_m2m_expires ON public.closing_pipeline_items (m2m_expires_at);
CREATE INDEX IF NOT EXISTS idx_cpi_dispatch_scan
  ON public.closing_pipeline_items (zip, base_contract_price)
  WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cpi_alloc_expires
  ON public.closing_pipeline_items (allocation_expires_at)
  WHERE cleared_at IS NULL;

-- 3. Contention-free claim: FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.m2m_claim_dispatch(_id uuid, _box_id uuid, _window_seconds integer DEFAULT 900)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_exp timestamptz;
BEGIN
  SELECT id INTO v_id
    FROM closing_pipeline_items
   WHERE id = _id
     AND cleared_at IS NULL
     AND (m2m_expires_at IS NULL OR m2m_expires_at < now())
   FOR UPDATE SKIP LOCKED;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'locked_or_cleared');
  END IF;

  v_exp := now() + make_interval(secs => GREATEST(_window_seconds, 5));
  UPDATE closing_pipeline_items
     SET m2m_box_id = _box_id,
         m2m_expires_at = v_exp,
         m2m_dispatched_at = now()
   WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'expires_at', v_exp);
END;
$function$;

-- 4. Dutch auction: 2.5% fee decay every 4h on unlocked, unsold inventory
CREATE OR REPLACE FUNCTION public.decay_stale_assignment_fees(_max_rows integer DEFAULT 200)
RETURNS TABLE(deal_id uuid, old_fee numeric, new_fee numeric, decay_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT c.id
      FROM closing_pipeline_items c
     WHERE c.cleared_at IS NULL
       AND (c.m2m_expires_at IS NULL OR c.m2m_expires_at < now())
       AND COALESCE(c.payout_status,'') NOT IN ('WIRE_PENDING_VERIFICATION','SETTLED_PAID')
       AND COALESCE(c.reverse_strike_ready, false) = true
       AND COALESCE(c.optimized_acquisition_premium, 0) > 1000
       AND COALESCE(c.fee_decay_count, 0) < 8
       AND COALESCE(c.updated_at, c.created_at) < now() - interval '4 hours'
     ORDER BY COALESCE(c.updated_at, c.created_at) ASC
     LIMIT GREATEST(_max_rows, 1)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE closing_pipeline_items t
     SET optimized_acquisition_premium = GREATEST(round(t.optimized_acquisition_premium * 0.975), 1000),
         fee_decay_count = COALESCE(t.fee_decay_count, 0) + 1,
         updated_at = now()
    FROM candidates cd
   WHERE t.id = cd.id
  RETURNING t.id, round(t.optimized_acquisition_premium / 0.975), t.optimized_acquisition_premium, t.fee_decay_count;
END;
$function$;

-- 5. Pre-flight validation gateway
CREATE OR REPLACE FUNCTION public.preflight_validate_lead(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r closing_pipeline_items; problems text[] := '{}';
BEGIN
  SELECT * INTO r FROM closing_pipeline_items WHERE id = _id;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  IF COALESCE(trim(r.address), '') = '' OR COALESCE(trim(r.zip), '') = '' THEN
    problems := problems || 'NO_NORMALIZED_ADDRESS';
  END IF;
  IF COALESCE(trim(COALESCE(r.owner_entity, r.active_owner, '')), '') = '' THEN
    problems := problems || 'NO_VERIFIED_OWNER';
  END IF;
  IF COALESCE(r.calculated_arv, 0) <= 0 THEN
    problems := problems || 'NO_VALUATION';
  ELSIF (COALESCE(r.calculated_arv,0) * 0.7)
        - COALESCE(r.estimated_repairs, 0)
        - COALESCE(r.base_contract_price, 0)
        < COALESCE(r.optimized_acquisition_premium, 0) THEN
    problems := problems || 'INSUFFICIENT_EQUITY_SPREAD';
  END IF;

  IF array_length(problems, 1) IS NULL THEN
    UPDATE closing_pipeline_items
       SET reverse_strike_ready = true, updated_at = now()
     WHERE id = _id;
    RETURN jsonb_build_object('ok', true, 'state', 'REVERSE_STRIKE_READY');
  END IF;

  UPDATE closing_pipeline_items
     SET reverse_strike_ready = false,
         enrichment_tags = (
           SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(enrichment_tags,'{}') || ARRAY['INVALID_LEAD']))
         ),
         updated_at = now()
   WHERE id = _id;
  RETURN jsonb_build_object('ok', false, 'state', 'INVALID_LEAD', 'problems', to_jsonb(problems));
END;
$function$;