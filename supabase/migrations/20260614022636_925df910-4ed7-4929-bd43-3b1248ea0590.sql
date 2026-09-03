
CREATE OR REPLACE FUNCTION public.record_endpoint_fill(_deal_id uuid, _latency_ms bigint)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _ep uuid;
BEGIN
  SELECT endpoint_id INTO _ep FROM public.routing_dispatch_log
    WHERE pipeline_item_id=_deal_id AND success=true
    ORDER BY created_at DESC LIMIT 1;
  IF _ep IS NULL THEN RETURN; END IF;
  UPDATE public.routing_endpoints SET
    avg_settlement_latency_ms = CASE
      WHEN avg_settlement_latency_ms IS NULL THEN _latency_ms
      ELSE (avg_settlement_latency_ms * 7 + _latency_ms * 3) / 10
    END,
    fill_count = fill_count + 1,
    updated_at = now()
  WHERE id = _ep;
END;
$$;

CREATE OR REPLACE FUNCTION public.tif_sweep_expired_locks()
 RETURNS TABLE(deal_id uuid, endpoint_id uuid)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _d record; _ep uuid;
BEGIN
  FOR _d IN
    SELECT id FROM public.closing_pipeline_items
    WHERE status='Locked-Escrow-Pending'::app_pipeline_status
      AND lock_expires_at IS NOT NULL
      AND lock_expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT rdl.endpoint_id INTO _ep FROM public.routing_dispatch_log rdl
      WHERE rdl.pipeline_item_id=_d.id ORDER BY rdl.created_at DESC LIMIT 1;
    UPDATE public.closing_pipeline_items SET
      status='Buyer-Signed'::app_pipeline_status,
      escrow_status='trade_busted',
      locked_at=NULL, locked_by_key_id=NULL, lock_expires_at=NULL,
      updated_at=now()
    WHERE id=_d.id;
    IF _ep IS NOT NULL THEN
      UPDATE public.routing_endpoints
        SET bust_count = bust_count + 1, updated_at = now()
        WHERE id = _ep;
    END IF;
    deal_id := _d.id; endpoint_id := _ep; RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.strike_lock_deal(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_endpoint_fill(uuid, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tif_sweep_expired_locks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.strike_lock_deal(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_endpoint_fill(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.tif_sweep_expired_locks() TO service_role;
