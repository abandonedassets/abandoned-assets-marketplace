-- =====================================================================
-- PHASE 1: SELF-HEALING + REJECTION TELEMETRY
-- Pillar 1: exception_queue + auto-retry sweep
-- Pillar 4: market_telemetry rejection logging
-- =====================================================================

-- ---------- PILLAR 1: EXCEPTION QUEUE -------------------------------
CREATE TABLE IF NOT EXISTS public.exception_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid NOT NULL REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  zip text,
  base_contract_price numeric,
  confidence_score integer,
  retry_count integer NOT NULL DEFAULT 0,
  last_retry_at timestamptz,
  last_error text,
  resolved_at timestamptz,
  resolution text, -- 'promoted' | 'abandoned' | NULL (still queued)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_item_id)
);

GRANT SELECT ON public.exception_queue TO authenticated;
GRANT ALL ON public.exception_queue TO service_role;

ALTER TABLE public.exception_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exception_queue_admin_all"
  ON public.exception_queue FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "exception_queue_owner_read"
  ON public.exception_queue FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.closing_pipeline_items c
    WHERE c.id = exception_queue.pipeline_item_id AND c.user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_exception_queue_unresolved
  ON public.exception_queue(created_at)
  WHERE resolved_at IS NULL;

CREATE TRIGGER trg_exception_queue_updated_at
  BEFORE UPDATE ON public.exception_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Route low-confidence assets into the queue on INSERT/UPDATE.
-- Threshold: configurable, default 95.
CREATE OR REPLACE FUNCTION public.cpi_route_to_exception_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _threshold integer;
BEGIN
  SELECT COALESCE((value)::text::integer, 95) INTO _threshold
  FROM public.system_config WHERE key = 'exception_queue_threshold';
  IF _threshold IS NULL THEN _threshold := 95; END IF;

  -- Only queue pre-clearance items; never re-queue cleared/closed/dead.
  IF NEW.status::text IN ('Funds-Cleared','Closed','Dead','CRITICAL_STALL','Locked-Escrow-Pending') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.confidence_score, 0) < _threshold THEN
    INSERT INTO public.exception_queue(pipeline_item_id, zip, base_contract_price, confidence_score)
    VALUES (NEW.id, NEW.zip, NEW.base_contract_price, NEW.confidence_score)
    ON CONFLICT (pipeline_item_id) DO UPDATE SET
      confidence_score = EXCLUDED.confidence_score,
      base_contract_price = EXCLUDED.base_contract_price,
      zip = EXCLUDED.zip,
      updated_at = now();
  ELSIF NEW.confidence_score >= _threshold THEN
    -- Auto-resolve if score crossed threshold via normal path
    UPDATE public.exception_queue
       SET resolved_at = now(), resolution = 'promoted', updated_at = now()
     WHERE pipeline_item_id = NEW.id AND resolved_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_route_exception ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_route_exception
  AFTER INSERT OR UPDATE OF confidence_score, base_contract_price
  ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_route_to_exception_queue();

-- Sweep function: recompute confidence, promote eligible, abandon after N retries.
CREATE OR REPLACE FUNCTION public.sweep_exception_queue(_max_retries integer DEFAULT 8)
RETURNS TABLE(pipeline_item_id uuid, action text, new_score integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _r RECORD; _threshold integer; _score integer;
BEGIN
  SELECT COALESCE((value)::text::integer, 95) INTO _threshold
  FROM public.system_config WHERE key = 'exception_queue_threshold';
  IF _threshold IS NULL THEN _threshold := 95; END IF;

  FOR _r IN
    SELECT eq.id AS eq_id, eq.pipeline_item_id, eq.retry_count, c.zip, c.base_contract_price
    FROM public.exception_queue eq
    JOIN public.closing_pipeline_items c ON c.id = eq.pipeline_item_id
    WHERE eq.resolved_at IS NULL
      AND c.status::text NOT IN ('Funds-Cleared','Closed','Dead','CRITICAL_STALL','Locked-Escrow-Pending')
    ORDER BY eq.created_at ASC
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      _score := public.compute_confidence_score(_r.zip, _r.base_contract_price);

      UPDATE public.closing_pipeline_items
         SET confidence_score = _score,
             manual_review = (_score < 50),
             updated_at = now()
       WHERE id = _r.pipeline_item_id;

      IF _score >= _threshold THEN
        UPDATE public.exception_queue
           SET resolved_at = now(), resolution = 'promoted',
               last_retry_at = now(), retry_count = retry_count + 1,
               confidence_score = _score, updated_at = now()
         WHERE id = _r.eq_id;
        pipeline_item_id := _r.pipeline_item_id; action := 'promoted'; new_score := _score;
        RETURN NEXT;
      ELSIF _r.retry_count + 1 >= _max_retries THEN
        UPDATE public.exception_queue
           SET resolved_at = now(), resolution = 'abandoned',
               last_retry_at = now(), retry_count = retry_count + 1,
               confidence_score = _score, updated_at = now()
         WHERE id = _r.eq_id;
        INSERT INTO public.system_alerts(severity, kind, message, deal_id, metadata)
        VALUES ('medium','exception_queue_abandoned',
          'Asset abandoned after ' || _max_retries || ' confidence retries',
          _r.pipeline_item_id,
          jsonb_build_object('zip',_r.zip,'final_score',_score,'threshold',_threshold));
        pipeline_item_id := _r.pipeline_item_id; action := 'abandoned'; new_score := _score;
        RETURN NEXT;
      ELSE
        UPDATE public.exception_queue
           SET last_retry_at = now(), retry_count = retry_count + 1,
               confidence_score = _score, updated_at = now()
         WHERE id = _r.eq_id;
        pipeline_item_id := _r.pipeline_item_id; action := 'retry'; new_score := _score;
        RETURN NEXT;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.exception_queue
         SET last_retry_at = now(), retry_count = retry_count + 1,
             last_error = SQLERRM, updated_at = now()
       WHERE id = _r.eq_id;
      pipeline_item_id := _r.pipeline_item_id; action := 'error'; new_score := NULL;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

-- ---------- PILLAR 4: REJECTION TELEMETRY ---------------------------
CREATE TABLE IF NOT EXISTS public.market_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE SET NULL,
  zip text,
  asset_type text,
  asset_price numeric,
  asset_margin numeric,
  nearest_buyer_id uuid,
  nearest_required_margin numeric,
  nearest_max_price numeric,
  yield_delta numeric,           -- asset_margin - nearest_required_margin (negative = short)
  price_delta numeric,           -- nearest_max_price - asset_price (negative = over budget)
  rejection_reason text,         -- 'no_zip_match' | 'margin_short' | 'price_over' | 'no_buyer_in_market'
  candidate_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.market_telemetry TO authenticated;
GRANT ALL ON public.market_telemetry TO service_role;

ALTER TABLE public.market_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "market_telemetry_admin_all"
  ON public.market_telemetry FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_market_telemetry_zip_created
  ON public.market_telemetry(zip, created_at DESC);

-- Log telemetry AFTER INSERT/UPDATE when matching produced no buyer.
CREATE OR REPLACE FUNCTION public.cpi_log_rejection_telemetry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _nearest RECORD;
  _candidates integer;
  _eff_type text;
  _asset_margin numeric;
  _reason text;
BEGIN
  IF NEW.matched_buyer_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.status::text IN ('Funds-Cleared','Closed','Dead','CRITICAL_STALL') THEN RETURN NEW; END IF;

  _eff_type := COALESCE(NEW.asset_type,'SFR');
  _asset_margin := COALESCE(NEW.optimized_acquisition_premium, 0);

  SELECT COUNT(*) INTO _candidates
  FROM public.buyer_buy_boxes
  WHERE active = true AND deprecated_at IS NULL
    AND NEW.zip = ANY(target_zip_codes)
    AND _eff_type = ANY(target_asset_types);

  -- Find nearest buyer in same zip+type so we can compute deltas
  SELECT buyer_id, min_placement_margin, max_contract_price
  INTO _nearest
  FROM public.buyer_buy_boxes
  WHERE active = true AND deprecated_at IS NULL
    AND NEW.zip = ANY(target_zip_codes)
    AND _eff_type = ANY(target_asset_types)
  ORDER BY (min_placement_margin - _asset_margin) ASC
  LIMIT 1;

  IF _candidates = 0 THEN
    _reason := 'no_buyer_in_market';
  ELSIF _nearest.min_placement_margin > _asset_margin
        AND _nearest.max_contract_price >= COALESCE(NEW.base_contract_price,0) THEN
    _reason := 'margin_short';
  ELSIF _nearest.max_contract_price < COALESCE(NEW.base_contract_price,0) THEN
    _reason := 'price_over';
  ELSE
    _reason := 'no_zip_match';
  END IF;

  INSERT INTO public.market_telemetry(
    pipeline_item_id, zip, asset_type, asset_price, asset_margin,
    nearest_buyer_id, nearest_required_margin, nearest_max_price,
    yield_delta, price_delta, rejection_reason, candidate_count
  ) VALUES (
    NEW.id, NEW.zip, _eff_type, NEW.base_contract_price, _asset_margin,
    _nearest.buyer_id, _nearest.min_placement_margin, _nearest.max_contract_price,
    _asset_margin - COALESCE(_nearest.min_placement_margin, 0),
    COALESCE(_nearest.max_contract_price, 0) - COALESCE(NEW.base_contract_price, 0),
    _reason, _candidates
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- Fail-forward: never block pipeline on telemetry.
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_log_rejection ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_log_rejection
  AFTER INSERT OR UPDATE OF zip, asset_type, base_contract_price, optimized_acquisition_premium, matched_buyer_id
  ON public.closing_pipeline_items
  FOR EACH ROW
  WHEN (NEW.matched_buyer_id IS NULL)
  EXECUTE FUNCTION public.cpi_log_rejection_telemetry();

-- Rolling 7-day rejection summary for the auto-underwriting feedback loop.
CREATE OR REPLACE FUNCTION public.market_telemetry_summary(_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH win AS (
    SELECT * FROM public.market_telemetry
    WHERE created_at >= now() - make_interval(days => _days)
  ),
  by_zip AS (
    SELECT zip,
           COUNT(*) AS rejections,
           AVG(yield_delta) AS avg_yield_delta,
           AVG(price_delta) AS avg_price_delta
    FROM win GROUP BY zip
    ORDER BY rejections DESC NULLS LAST LIMIT 25
  ),
  by_reason AS (
    SELECT rejection_reason, COUNT(*) AS n FROM win GROUP BY rejection_reason
  )
  SELECT jsonb_build_object(
    'window_days', _days,
    'total', (SELECT COUNT(*) FROM win),
    'by_zip', COALESCE((SELECT jsonb_agg(to_jsonb(by_zip.*)) FROM by_zip), '[]'::jsonb),
    'by_reason', COALESCE((SELECT jsonb_object_agg(rejection_reason, n) FROM by_reason), '{}'::jsonb),
    'generated_at', now()
  );
$$;
