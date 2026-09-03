
CREATE OR REPLACE FUNCTION public.m2m_claim_dispatch(_id uuid, _box_id uuid, _window_seconds integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.closing_pipeline_items;
BEGIN
  SELECT * INTO r FROM public.closing_pipeline_items WHERE id = _id FOR UPDATE;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF COALESCE(r.tif_state,'') = 'Executed'
     OR COALESCE(r.payout_status,'') IN ('WIRE_PENDING_VERIFICATION','SETTLED_PAID') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_locked');
  END IF;
  IF r.m2m_expires_at IS NOT NULL AND r.m2m_expires_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'dispatch_in_flight');
  END IF;
  IF r.reservation_expires_at IS NOT NULL AND r.reservation_expires_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'human_reservation_active');
  END IF;
  UPDATE public.closing_pipeline_items
     SET m2m_box_id = _box_id, m2m_dispatched_at = now(),
         m2m_expires_at = now() + make_interval(secs => GREATEST(_window_seconds, 5))
   WHERE id = _id;
  RETURN jsonb_build_object('ok', true, 'expires_at', now() + make_interval(secs => GREATEST(_window_seconds, 5)));
END; $$;

CREATE OR REPLACE FUNCTION public.m2m_accept(_id uuid, _box_id uuid, _signature text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.closing_pipeline_items; v_memo text;
BEGIN
  SELECT * INTO r FROM public.closing_pipeline_items WHERE id = _id FOR UPDATE;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF COALESCE(r.tif_state,'') = 'Executed'
     OR COALESCE(r.payout_status,'') IN ('WIRE_PENDING_VERIFICATION','SETTLED_PAID') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'asset_already_locked');
  END IF;
  IF r.m2m_box_id IS DISTINCT FROM _box_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_dispatched_to_caller');
  END IF;
  IF r.m2m_expires_at IS NULL OR r.m2m_expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'handshake_window_expired');
  END IF;

  v_memo := 'BV-' || upper(substr(replace(_id::text, '-', ''), 1, 8)) || '-' || to_char(now(), 'YYMMDDHH24MISS');

  UPDATE public.closing_pipeline_items
     SET payout_status = 'WIRE_PENDING_VERIFICATION',
         tif_state = 'Executed',
         dynamic_memo_id = v_memo,
         m2m_expires_at = NULL,
         reservation_expires_at = NULL,
         reservation_email = NULL,
         matched_buy_box_id = _box_id
   WHERE id = _id;

  BEGIN
    INSERT INTO public.offer_delivery_logs (contract_id, status, meta)
    VALUES (_id, 'EXECUTED', jsonb_build_object('channel','M2M','signature',_signature,'box_id',_box_id));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'property_id', _id, 'state', 'WIRE_PENDING_VERIFICATION',
    'memo_id', v_memo, 'assignment_fee', r.optimized_acquisition_premium, 'price', r.base_contract_price);
END; $$;

CREATE OR REPLACE FUNCTION public.sweep_expired_m2m()
RETURNS TABLE(deal_id uuid, box_id uuid, action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT id, m2m_box_id FROM public.closing_pipeline_items
     WHERE m2m_expires_at IS NOT NULL AND m2m_expires_at < now()
       AND COALESCE(tif_state,'') <> 'Executed'
       AND COALESCE(payout_status,'') NOT IN ('WIRE_PENDING_VERIFICATION','SETTLED_PAID')
     LIMIT 500
  LOOP
    BEGIN
      UPDATE public.closing_pipeline_items
         SET m2m_expires_at = NULL, m2m_box_id = NULL,
             tif_state = 'Expired', tif_expires_at = now() - interval '1 second'
       WHERE id = rec.id;
      deal_id := rec.id; box_id := rec.m2m_box_id; action := 'M2M_TIMEOUT_RECASCADED';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN CONTINUE; END;
  END LOOP;
END; $$;

REVOKE EXECUTE ON FUNCTION public.m2m_claim_dispatch(uuid, uuid, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.m2m_accept(uuid, uuid, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sweep_expired_m2m() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.m2m_claim_dispatch(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.m2m_accept(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_expired_m2m() TO service_role;
