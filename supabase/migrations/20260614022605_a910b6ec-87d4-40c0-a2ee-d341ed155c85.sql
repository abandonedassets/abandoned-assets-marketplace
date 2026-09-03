
DROP FUNCTION IF EXISTS public.strike_lock_deal(uuid, uuid);

CREATE FUNCTION public.strike_lock_deal(_deal_id uuid, _key_id uuid)
 RETURNS TABLE(id uuid, status text, locked_at timestamptz, lock_expires_at timestamptz, base_contract_price numeric, optimized_acquisition_premium numeric, zip text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _row public.closing_pipeline_items;
BEGIN
  SELECT * INTO _row FROM public.closing_pipeline_items
    WHERE closing_pipeline_items.id = _deal_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF _row.status::text IN ('Locked-Escrow-Pending','Funds-Cleared','Closed','Dead','CRITICAL_STALL') OR _row.is_held = true THEN
    RAISE EXCEPTION 'ALREADY_CLEARED' USING ERRCODE='P0001';
  END IF;
  UPDATE public.closing_pipeline_items
    SET status='Locked-Escrow-Pending'::app_pipeline_status,
        escrow_status='pending_dispatch',
        locked_at=now(),
        lock_expires_at=now() + interval '24 hours',
        locked_by_key_id=_key_id
    WHERE closing_pipeline_items.id=_deal_id;
  RETURN QUERY
    SELECT c.id, c.status::text, c.locked_at, c.lock_expires_at, c.base_contract_price, c.optimized_acquisition_premium, c.zip
    FROM public.closing_pipeline_items c WHERE c.id=_deal_id;
END;
$function$;

-- Enable Realtime on the pipeline table for the SSE-equivalent live feed
ALTER PUBLICATION supabase_realtime ADD TABLE public.closing_pipeline_items;
