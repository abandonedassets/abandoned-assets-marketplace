-- 1. Cryptographic dark crossing: encrypted intents, zero readable criteria at rest.
CREATE TABLE public.dark_cross_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid REFERENCES public.institutional_api_keys(id) ON DELETE CASCADE,
  box_id uuid,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  intent_hash text NOT NULL,
  max_notional numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'OPEN',
  crossed_deal_id uuid,
  crossed_at timestamptz,
  cross_proof text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX dark_cross_intents_hash_open
  ON public.dark_cross_intents (api_key_id, intent_hash)
  WHERE status = 'OPEN';
CREATE INDEX dark_cross_intents_open ON public.dark_cross_intents (status, expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dark_cross_intents TO authenticated;
GRANT ALL ON public.dark_cross_intents TO service_role;
ALTER TABLE public.dark_cross_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read dark cross intents"
  ON public.dark_cross_intents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage dark cross intents"
  ON public.dark_cross_intents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_dark_cross_intents_updated
  BEFORE UPDATE ON public.dark_cross_intents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Micro-TIF: millisecond-granular lock decay.
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS m2m_handshake_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS m2m_lock_ms integer NOT NULL DEFAULT 60000;

ALTER TABLE public.buyer_buy_boxes
  ADD COLUMN IF NOT EXISTS latency_strikes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_latency_strike_at timestamptz;

CREATE OR REPLACE FUNCTION public.sweep_micro_tif()
RETURNS TABLE(deal_id uuid, box_id uuid, overdue_ms integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id, m2m_box_id,
           GREATEST(0, EXTRACT(EPOCH FROM (now() - m2m_handshake_deadline)) * 1000)::int AS over_ms
      FROM public.closing_pipeline_items
     WHERE m2m_box_id IS NOT NULL
       AND m2m_handshake_deadline IS NOT NULL
       AND m2m_handshake_deadline < now()
       AND COALESCE(tif_state,'') <> 'Executed'
       AND COALESCE(payout_status,'') NOT IN ('WIRE_PENDING_VERIFICATION','SETTLED_PAID')
     LIMIT 500
  LOOP
    UPDATE public.closing_pipeline_items
       SET m2m_box_id = NULL,
           m2m_expires_at = NULL,
           m2m_handshake_deadline = NULL
     WHERE id = r.id;

    BEGIN
      UPDATE public.buyer_buy_boxes
         SET latency_strikes = latency_strikes + 1,
             last_latency_strike_at = now()
       WHERE id = r.m2m_box_id;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    deal_id := r.id; box_id := r.m2m_box_id; overdue_ms := r.over_ms;
    RETURN NEXT;
  END LOOP;
END; $$;

-- Sub-second claim: stamps a precise deadline alongside the legacy window.
CREATE OR REPLACE FUNCTION public.m2m_claim_micro(_id uuid, _box_id uuid, _lock_ms integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.closing_pipeline_items; v_ms integer; v_dead timestamptz;
BEGIN
  v_ms := GREATEST(COALESCE(_lock_ms, 60000), 250);
  SELECT * INTO r FROM public.closing_pipeline_items WHERE id = _id FOR UPDATE;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF COALESCE(r.tif_state,'') = 'Executed'
     OR COALESCE(r.payout_status,'') IN ('WIRE_PENDING_VERIFICATION','SETTLED_PAID') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_locked');
  END IF;
  IF r.m2m_handshake_deadline IS NOT NULL AND r.m2m_handshake_deadline > now()
     AND r.m2m_box_id IS DISTINCT FROM _box_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lock_held_by_other');
  END IF;
  IF r.reservation_expires_at IS NOT NULL AND r.reservation_expires_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'human_reservation_active');
  END IF;

  v_dead := now() + make_interval(secs => v_ms / 1000.0);
  UPDATE public.closing_pipeline_items
     SET m2m_box_id = _box_id,
         m2m_dispatched_at = now(),
         m2m_lock_ms = v_ms,
         m2m_handshake_deadline = v_dead,
         m2m_expires_at = v_dead
   WHERE id = _id;

  RETURN jsonb_build_object('ok', true, 'deadline', v_dead, 'lock_ms', v_ms);
END; $$;

GRANT EXECUTE ON FUNCTION public.sweep_micro_tif() TO service_role;
GRANT EXECUTE ON FUNCTION public.m2m_claim_micro(uuid, uuid, integer) TO service_role;