
DROP FUNCTION IF EXISTS public.strike_lock_deal(uuid, uuid);

CREATE FUNCTION public.strike_lock_deal(_deal_id uuid, _key_id uuid)
 RETURNS TABLE(id uuid, status text, locked_at timestamp with time zone, lock_expires_at timestamp with time zone, base_contract_price numeric, optimized_acquisition_premium numeric, zip text, was_already_locked boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _row public.closing_pipeline_items;
BEGIN
  SELECT * INTO _row FROM public.closing_pipeline_items
    WHERE closing_pipeline_items.id = _deal_id
    FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    SELECT * INTO _row FROM public.closing_pipeline_items
      WHERE closing_pipeline_items.id = _deal_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF _row.status::text = 'Locked-Escrow-Pending' THEN
      RETURN QUERY SELECT _row.id, _row.status::text, _row.locked_at,
        _row.lock_expires_at, _row.base_contract_price,
        _row.optimized_acquisition_premium, _row.zip, true;
      RETURN;
    END IF;
    RAISE EXCEPTION 'STRIKE_RACE_CONTENTION' USING ERRCODE='P0001';
  END IF;

  IF _row.status::text = 'Locked-Escrow-Pending'
     AND _row.locked_by_key_id = _key_id THEN
    RETURN QUERY SELECT _row.id, _row.status::text, _row.locked_at,
      _row.lock_expires_at, _row.base_contract_price,
      _row.optimized_acquisition_premium, _row.zip, true;
    RETURN;
  END IF;

  IF _row.requires_legal_review = true THEN
    RAISE EXCEPTION 'LEGAL_HOLD' USING ERRCODE='P0001'; END IF;
  IF _row.manual_review = true THEN
    RAISE EXCEPTION 'MANUAL_REVIEW_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF _row.is_stale = true THEN
    RAISE EXCEPTION 'ASSET_STALE' USING ERRCODE='P0001'; END IF;
  IF _row.status::text IN ('Locked-Escrow-Pending','Funds-Cleared','Closed','Dead','CRITICAL_STALL')
     OR _row.is_held = true THEN
    RAISE EXCEPTION 'ALREADY_CLEARED' USING ERRCODE='P0001'; END IF;

  UPDATE public.closing_pipeline_items
    SET status='Locked-Escrow-Pending'::app_pipeline_status,
        escrow_status='pending_dispatch',
        locked_at=now(),
        lock_expires_at=now() + interval '24 hours',
        locked_by_key_id=_key_id
    WHERE closing_pipeline_items.id=_deal_id;

  RETURN QUERY
    SELECT c.id, c.status::text, c.locked_at, c.lock_expires_at,
           c.base_contract_price, c.optimized_acquisition_premium, c.zip, false
    FROM public.closing_pipeline_items c WHERE c.id=_deal_id;
END;
$function$;

ALTER TABLE public.closing_pipeline_items REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='closing_pipeline_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.closing_pipeline_items;
  END IF;
END $$;
