
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS liquidity_match_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS liquidity_bucket text NOT NULL DEFAULT 'cold',
  ADD COLUMN IF NOT EXISTS liquidity_scored_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cpi_liquidity_score
  ON public.closing_pipeline_items(liquidity_match_score DESC, liquidity_bucket);

CREATE OR REPLACE FUNCTION public.compute_liquidity_match(_item public.closing_pipeline_items)
RETURNS TABLE(score integer, bucket text, buy_box_id uuid, buyer_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _best RECORD; _sc int; _bk text;
BEGIN
  SELECT bb.id AS bb_id, bb.buyer_id AS b_id,
    ( (CASE WHEN bb.target_zip_codes IS NULL OR array_length(bb.target_zip_codes,1) IS NULL THEN 2
            WHEN _item.zip = ANY(bb.target_zip_codes) THEN 4 ELSE 0 END)
    + (CASE WHEN bb.target_asset_types IS NULL OR array_length(bb.target_asset_types,1) IS NULL THEN 1
            WHEN COALESCE(_item.asset_type,'') = ANY(bb.target_asset_types) THEN 3 ELSE 0 END)
    + (CASE WHEN bb.max_contract_price IS NULL THEN 1
            WHEN COALESCE(_item.base_contract_price,0) <= bb.max_contract_price THEN 3 ELSE 0 END)
    ) AS s
  INTO _best
  FROM public.buyer_buy_boxes bb
  WHERE bb.active = true AND bb.deprecated_at IS NULL
  ORDER BY s DESC NULLS LAST
  LIMIT 1;

  IF _best.bb_id IS NULL THEN
    score := 0; bucket := 'waiting_for_demand'; buy_box_id := NULL; buyer_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  _sc := LEAST(GREATEST(_best.s,0),10);
  _bk := CASE WHEN _sc >= 8 THEN 'hot'
              WHEN _sc >= 5 THEN 'warm'
              WHEN _sc >= 1 THEN 'cool'
              ELSE 'cold' END;
  score := _sc; bucket := _bk; buy_box_id := _best.bb_id; buyer_id := _best.b_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_cpi_score_liquidity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r RECORD;
BEGIN
  IF NEW.status IN ('Funds-Cleared'::app_pipeline_status,
                    'Dead'::app_pipeline_status,
                    'Rejected'::app_pipeline_status) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO _r FROM public.compute_liquidity_match(NEW);
  NEW.liquidity_match_score := COALESCE(_r.score,0);
  NEW.liquidity_bucket := COALESCE(_r.bucket,'cold');
  NEW.liquidity_scored_at := now();
  IF NEW.matched_buy_box_id IS NULL AND _r.buy_box_id IS NOT NULL AND _r.score >= 5 THEN
    NEW.matched_buy_box_id := _r.buy_box_id;
    NEW.matched_buyer_id := _r.buyer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_score_liquidity ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_score_liquidity
BEFORE INSERT OR UPDATE OF zip, asset_type, base_contract_price, status
ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.trg_cpi_score_liquidity();

CREATE OR REPLACE FUNCTION public.auto_clear_eligible_deals()
RETURNS TABLE(deal_id uuid, cleared_amount numeric, zip text, action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _r RECORD; _amt NUMERIC; _evt TEXT;
  _cap NUMERIC; _cleared_today NUMERIC; _remaining NUMERIC;
BEGIN
  SELECT COALESCE((value)::text::numeric, 5000) INTO _cap
  FROM public.system_config WHERE key = 'daily_payout_cap_usd';
  IF _cap IS NULL THEN _cap := 5000; END IF;
  _cleared_today := public.cleared_today_usd();
  _remaining := GREATEST(_cap - _cleared_today, 0);

  UPDATE public.closing_pipeline_items
     SET status = 'Locked-Escrow-Pending'::app_pipeline_status,
         escrow_status = 'pending_dispatch', updated_at = now()
   WHERE status = 'Queued-For-Tomorrow'::app_pipeline_status
     AND updated_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  FOR _r IN
    SELECT id, zip, optimized_acquisition_premium, locked_at, clear_retry_count
    FROM public.closing_pipeline_items
    WHERE status = 'Locked-Escrow-Pending'::app_pipeline_status
      AND COALESCE(manual_review,false) = false
      AND COALESCE(is_stale,false) = false
      AND COALESCE(requires_legal_review,false) = false
      AND COALESCE(confidence_score,0) >= 50
      AND liquidity_bucket IN ('hot','warm')
      AND locked_at IS NOT NULL
      AND locked_at < now() - interval '30 seconds'
    ORDER BY liquidity_match_score DESC, locked_at ASC
    LIMIT 10
    FOR UPDATE SKIP LOCKED
  LOOP
    _amt := COALESCE(_r.optimized_acquisition_premium, 0);
    IF _amt > _remaining THEN
      UPDATE public.closing_pipeline_items SET
        status = 'Queued-For-Tomorrow'::app_pipeline_status,
        escrow_status = 'queued_rollover', updated_at = now()
      WHERE id = _r.id;
      deal_id := _r.id; cleared_amount := _amt; zip := _r.zip; action := 'queued';
      RETURN NEXT; CONTINUE;
    END IF;
    BEGIN
      _evt := 'auto_clear:' || _r.id::text || ':' || extract(epoch from now())::bigint;
      UPDATE public.closing_pipeline_items SET
        status = 'Funds-Cleared'::app_pipeline_status,
        escrow_status = 'cleared', cleared_at = now(), cleared_amount = _amt,
        lock_expires_at = NULL, is_stale = false,
        clear_retry_count = 0, updated_at = now()
      WHERE id = _r.id;
      INSERT INTO public.processed_ledger_events(event_id) VALUES (_evt) ON CONFLICT DO NOTHING;
      _remaining := _remaining - _amt;
      deal_id := _r.id; cleared_amount := _amt; zip := _r.zip; action := 'cleared';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      IF _r.clear_retry_count + 1 >= 3 THEN
        UPDATE public.closing_pipeline_items SET
          status = 'System-Hold'::app_pipeline_status,
          escrow_status = 'dead_letter',
          clear_retry_count = _r.clear_retry_count + 1, updated_at = now()
        WHERE id = _r.id;
        INSERT INTO public.system_alerts(severity, kind, message, deal_id, metadata)
        VALUES ('high','dead_letter_clearing',
          'Asset moved to SYSTEM-HOLD after 3 consecutive clearing failures',
          _r.id,
          jsonb_build_object('zip',_r.zip,'amount',_amt,'last_error',SQLERRM));
        deal_id := _r.id; cleared_amount := _amt; zip := _r.zip; action := 'dead_letter';
        RETURN NEXT;
      ELSE
        UPDATE public.closing_pipeline_items SET
          clear_retry_count = _r.clear_retry_count + 1, updated_at = now()
        WHERE id = _r.id;
        deal_id := _r.id; cleared_amount := _amt; zip := _r.zip; action := 'retry';
        RETURN NEXT;
      END IF;
    END;
  END LOOP;
END;
$function$;

-- Backfill via cross-join lateral
WITH scored AS (
  SELECT c2.id, m.score, m.bucket, m.buy_box_id, m.buyer_id
  FROM public.closing_pipeline_items c2
  CROSS JOIN LATERAL public.compute_liquidity_match(c2) m
  WHERE c2.status NOT IN ('Funds-Cleared'::app_pipeline_status,
                          'Dead'::app_pipeline_status,
                          'Rejected'::app_pipeline_status)
)
UPDATE public.closing_pipeline_items c
SET liquidity_match_score = s.score,
    liquidity_bucket = s.bucket,
    liquidity_scored_at = now(),
    matched_buy_box_id = COALESCE(c.matched_buy_box_id, CASE WHEN s.score >= 5 THEN s.buy_box_id END),
    matched_buyer_id   = COALESCE(c.matched_buyer_id,   CASE WHEN s.score >= 5 THEN s.buyer_id END)
FROM scored s
WHERE c.id = s.id;
