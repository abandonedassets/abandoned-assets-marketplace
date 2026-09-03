
CREATE OR REPLACE FUNCTION public.resuscitate_pipeline_item(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row closing_pipeline_items%ROWTYPE;
  v_house_bid_min_fee numeric := 25000;
  v_house_bid_age_min int := 30;
  v_flagged boolean := false;
BEGIN
  SELECT * INTO v_row FROM closing_pipeline_items WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_row.status <> 'New' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'status', v_row.status);
  END IF;

  UPDATE closing_pipeline_items
     SET updated_at = now(),
         resuscitation_count = resuscitation_count + 1,
         last_resuscitated_at = now()
   WHERE id = p_id;

  SELECT * INTO v_row FROM closing_pipeline_items WHERE id = p_id;

  IF v_row.status = 'New'
     AND COALESCE(v_row.optimized_acquisition_premium, 0) >= v_house_bid_min_fee
     AND v_row.created_at < now() - (v_house_bid_age_min || ' minutes')::interval THEN
    UPDATE closing_pipeline_items
       SET status = 'House-Bid',
           house_bid_flagged_at = now()
     WHERE id = p_id;
    v_flagged := true;

    INSERT INTO system_alerts (kind, severity, message, deal_id, metadata)
    VALUES (
      'HOUSE_BID_PENDING_REVIEW',
      'warning',
      'Asset flagged House-Bid — manual confirmation required (no auto-escrow).',
      v_row.id,
      jsonb_build_object(
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
