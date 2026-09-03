
-- 1) House-Bid status + Resuscitator instrumentation
ALTER TYPE app_pipeline_status ADD VALUE IF NOT EXISTS 'House-Bid';

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS resuscitation_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_resuscitated_at timestamptz,
  ADD COLUMN IF NOT EXISTS house_bid_flagged_at timestamptz;

-- 2) Surgical match-resuscitation RPC.
--    Bumps updated_at to re-fire match_orange_squares trigger on a SINGLE row.
--    If still 'New' + high-margin + stale after re-match, flips to 'House-Bid'
--    and writes a manual-confirmation alert (no auto-escrow, no synthetic fill).
CREATE OR REPLACE FUNCTION public.resuscitate_pipeline_item(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row closing_pipeline_items%ROWTYPE;
  v_house_bid_min_fee numeric := 25000;
  v_house_bid_age_min int := 30; -- minutes orphaned before House-Bid eligible
  v_flagged boolean := false;
BEGIN
  SELECT * INTO v_row FROM closing_pipeline_items WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_row.status <> 'New' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'status', v_row.status);
  END IF;

  -- Re-fire BEFORE UPDATE matcher trigger by bumping updated_at + counter
  UPDATE closing_pipeline_items
     SET updated_at = now(),
         resuscitation_count = resuscitation_count + 1,
         last_resuscitated_at = now()
   WHERE id = p_id;

  SELECT * INTO v_row FROM closing_pipeline_items WHERE id = p_id;

  -- If matcher didn't promote and asset is high-margin + sufficiently aged,
  -- escalate to House-Bid for manual confirmation.
  IF v_row.status = 'New'
     AND COALESCE(v_row.optimized_acquisition_premium, 0) >= v_house_bid_min_fee
     AND v_row.created_at < now() - (v_house_bid_age_min || ' minutes')::interval THEN
    UPDATE closing_pipeline_items
       SET status = 'House-Bid',
           house_bid_flagged_at = now()
     WHERE id = p_id;
    v_flagged := true;

    INSERT INTO system_alerts (alert_type, severity, message, metadata)
    VALUES (
      'HOUSE_BID_PENDING_REVIEW',
      'warning',
      'Asset flagged House-Bid — manual confirmation required (no auto-escrow).',
      jsonb_build_object(
        'pipeline_item_id', v_row.id,
        'address', v_row.address,
        'zip', v_row.zip,
        'fee_usd', v_row.optimized_acquisition_premium,
        'resuscitation_count', v_row.resuscitation_count
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'status', CASE WHEN v_flagged THEN 'House-Bid' ELSE v_row.status END,
    'resuscitation_count', v_row.resuscitation_count,
    'house_bid_flagged', v_flagged
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resuscitate_pipeline_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resuscitate_pipeline_item(uuid) TO service_role;

-- 3) Block any owner-side write to House-Bid status — manual confirm via service_role only
-- (existing cpi_block_owner_sensitive_updates already covers status)

-- 4) Schedule per-row surgical resuscitation every 5 minutes.
--    Finds 'New' rows that haven't moved in >5 minutes and POSTs each id to
--    the dedicated /api/public/hooks/match-resuscitate endpoint.
DO $$
BEGIN
  PERFORM cron.unschedule('match-resuscitate-sweep');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'match-resuscitate-sweep',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://project--dd9b0412-ab83-4f6e-86a4-cd1dedd921cc.lovable.app/api/public/hooks/match-resuscitate',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphYm5yZm91d21leWZrcm1lbHhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMzUxNTgsImV4cCI6MjA5NjgxMTE1OH0.r9PFot5_liO3d2K4aa_83kAD4qgq9cByin5LwJu7VTw"}'::jsonb,
    body := jsonb_build_object('row_id', cpi.id::text)
  )
  FROM closing_pipeline_items cpi
  WHERE cpi.status = 'New'
    AND cpi.updated_at < now() - interval '5 minutes'
  LIMIT 50;
  $cron$
);
