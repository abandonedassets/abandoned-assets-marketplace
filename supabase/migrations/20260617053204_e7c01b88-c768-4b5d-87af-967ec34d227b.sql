
-- 1. Confidence score + manual review + stale flag
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS confidence_score INTEGER,
  ADD COLUMN IF NOT EXISTS manual_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stale_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cpi_is_stale ON public.closing_pipeline_items(is_stale) WHERE is_stale = false;
CREATE INDEX IF NOT EXISTS idx_cpi_manual_review ON public.closing_pipeline_items(manual_review) WHERE manual_review = true;

-- 2. Confidence scoring function: compare price to ZIP median
CREATE OR REPLACE FUNCTION public.compute_confidence_score(_zip TEXT, _price NUMERIC)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _median NUMERIC;
  _sample_size INTEGER;
  _ratio NUMERIC;
  _score INTEGER;
BEGIN
  IF _zip IS NULL OR _price IS NULL OR _price <= 0 THEN RETURN 0; END IF;

  -- Absolute sanity bounds first
  IF _price < 100 OR _price > 50000000 THEN RETURN 0; END IF;

  SELECT
    percentile_cont(0.5) WITHIN GROUP (ORDER BY base_contract_price),
    COUNT(*)
  INTO _median, _sample_size
  FROM public.closing_pipeline_items
  WHERE zip = _zip AND base_contract_price > 0;

  -- Not enough comparable data → neutral confidence (don't block)
  IF _sample_size < 3 OR _median IS NULL OR _median <= 0 THEN
    RETURN 75;
  END IF;

  _ratio := _price / _median;

  -- Score: 100 at parity, falling off as ratio diverges from 1.0
  -- ratio 0.5-2.0 → 70-100, 0.25-4.0 → 40-70, beyond → <40
  IF _ratio BETWEEN 0.5 AND 2.0 THEN
    _score := 100 - ROUND(ABS(LN(_ratio)) * 40);
  ELSIF _ratio BETWEEN 0.25 AND 4.0 THEN
    _score := 65 - ROUND(ABS(LN(_ratio)) * 20);
  ELSE
    _score := GREATEST(0, 30 - ROUND(ABS(LN(_ratio)) * 10));
  END IF;

  RETURN GREATEST(0, LEAST(100, _score));
END;
$$;

-- 3. Trigger to populate confidence on insert/price change
CREATE OR REPLACE FUNCTION public.cpi_set_confidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.confidence_score IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.base_contract_price IS DISTINCT FROM OLD.base_contract_price) THEN
    NEW.confidence_score := public.compute_confidence_score(NEW.zip, NEW.base_contract_price);
    NEW.manual_review := COALESCE(NEW.confidence_score, 0) < 50;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_confidence ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_confidence
  BEFORE INSERT OR UPDATE OF base_contract_price ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_set_confidence();

-- Backfill existing rows
UPDATE public.closing_pipeline_items
SET confidence_score = public.compute_confidence_score(zip, base_contract_price)
WHERE confidence_score IS NULL;

UPDATE public.closing_pipeline_items
SET manual_review = (COALESCE(confidence_score, 0) < 50)
WHERE manual_review = false AND COALESCE(confidence_score, 0) < 50;

-- 4. Harden strike_lock_deal: block manual-review and stale assets
CREATE OR REPLACE FUNCTION public.strike_lock_deal(_deal_id uuid, _key_id uuid)
 RETURNS TABLE(id uuid, status text, locked_at timestamp with time zone, lock_expires_at timestamp with time zone, base_contract_price numeric, optimized_acquisition_premium numeric, zip text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _row public.closing_pipeline_items;
BEGIN
  SELECT * INTO _row FROM public.closing_pipeline_items
    WHERE closing_pipeline_items.id = _deal_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF _row.manual_review = true THEN
    RAISE EXCEPTION 'MANUAL_REVIEW_REQUIRED' USING ERRCODE='P0001';
  END IF;
  IF _row.is_stale = true THEN
    RAISE EXCEPTION 'ASSET_STALE' USING ERRCODE='P0001';
  END IF;
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

-- 5. Observer: sweep stale assets (>48h in New / Buyer-Signed / In-Escrow / Locked)
CREATE OR REPLACE FUNCTION public.observer_sweep_stale()
RETURNS TABLE(marked_stale INTEGER, busted_locks INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _marked INTEGER := 0; _busted INTEGER := 0;
BEGIN
  -- Mark stale: anything sitting >48h in pre-clearance states
  WITH upd AS (
    UPDATE public.closing_pipeline_items
    SET is_stale = true,
        stale_at = now(),
        updated_at = now()
    WHERE is_stale = false
      AND status::text IN ('New','Buyer-Signed','In-Escrow')
      AND created_at < now() - interval '48 hours'
      AND COALESCE(cleared_at, '1970-01-01'::timestamptz) < now() - interval '48 hours'
    RETURNING 1
  )
  SELECT COUNT(*) INTO _marked FROM upd;

  -- Also bust Locked-Escrow-Pending past 48h that the TIF sweep missed
  WITH busted AS (
    UPDATE public.closing_pipeline_items
    SET is_stale = true,
        stale_at = now(),
        status = 'Buyer-Signed'::app_pipeline_status,
        escrow_status = 'stale_observer',
        locked_at = NULL,
        locked_by_key_id = NULL,
        lock_expires_at = NULL,
        updated_at = now()
    WHERE status = 'Locked-Escrow-Pending'::app_pipeline_status
      AND locked_at IS NOT NULL
      AND locked_at < now() - interval '48 hours'
    RETURNING 1
  )
  SELECT COUNT(*) INTO _busted FROM busted;

  marked_stale := _marked;
  busted_locks := _busted;
  RETURN NEXT;
END;
$$;

-- 6. Idempotent clear: only flip if not already Funds-Cleared
CREATE OR REPLACE FUNCTION public.clear_funds_idempotent(
  _deal_id uuid,
  _cleared_amount numeric,
  _stripe_event_id text
)
RETURNS TABLE(deal_id uuid, was_already_cleared boolean, cleared_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _row public.closing_pipeline_items; _now timestamptz := now();
BEGIN
  SELECT * INTO _row FROM public.closing_pipeline_items
    WHERE id = _deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;

  IF _row.status = 'Funds-Cleared'::app_pipeline_status OR _row.cleared_at IS NOT NULL THEN
    deal_id := _row.id; was_already_cleared := true; cleared_at := _row.cleared_at;
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.closing_pipeline_items SET
    status = 'Funds-Cleared'::app_pipeline_status,
    escrow_status = 'cleared',
    cleared_at = _now,
    cleared_amount = _cleared_amount,
    lock_expires_at = NULL,
    is_stale = false,
    updated_at = _now
  WHERE id = _deal_id;

  deal_id := _deal_id; was_already_cleared := false; cleared_at := _now;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.observer_sweep_stale() TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_funds_idempotent(uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_confidence_score(text, numeric) TO authenticated, service_role;
