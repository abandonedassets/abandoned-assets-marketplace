
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS tif_offered_buyer_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tif_cascade_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contract_payload jsonb;

CREATE INDEX IF NOT EXISTS idx_cpi_tif_pending
  ON public.closing_pipeline_items (tif_expires_at)
  WHERE tif_state = 'Pending_Signature';

-- Assemble a standardized contract payload for a deal + buy box
CREATE OR REPLACE FUNCTION public.assemble_contract_payload(_id uuid, _box_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE d record; b record; _price numeric; _fee numeric;
BEGIN
  SELECT * INTO d FROM public.closing_pipeline_items WHERE id = _id;
  IF d IS NULL THEN RETURN NULL; END IF;
  IF _box_id IS NOT NULL THEN SELECT * INTO b FROM public.buyer_buy_boxes WHERE id = _box_id; END IF;

  _price := coalesce(d.base_contract_price, 0);
  _fee := coalesce(d.optimized_acquisition_premium, greatest(_price * 0.05, 250));

  RETURN jsonb_build_object(
    'contract_version', 'PSA-ASSIGNABLE-1.0',
    'deal_id', d.id,
    'assembled_at', now(),
    'seller_escrow_entity', 'AbandonedAsset Settlement Trust FBO ' || coalesce(d.external_id, left(d.id::text, 8)),
    'property', jsonb_build_object(
      'address', d.address, 'city', d.city, 'state', d.state, 'zip', d.zip,
      'apn', d.apn, 'asset_type', d.asset_type, 'acreage', d.acreage
    ),
    'economics', jsonb_build_object(
      'base_contract_price', _price,
      'assignment_fee', _fee,
      'recorded_liens', coalesce(d.lien_total, 0),
      'net_to_seller', greatest(0, _price - coalesce(d.lien_total, 0)),
      'total_acquisition_cost', _price + _fee,
      'emd_hold_usd', 1000
    ),
    'underwriting', jsonb_build_object(
      'm2m_value', coalesce(d.assessed_value, _price),
      'target_cap_rate', round((_fee / nullif(_price, 0) * 100)::numeric, 2),
      'title_status', d.title_status,
      'lien_cleared', coalesce(d.lien_total, 0) = 0,
      'confidence_score', d.confidence_score
    ),
    'buy_box', CASE WHEN b IS NULL THEN NULL ELSE jsonb_build_object(
      'buy_box_id', b.id, 'buyer_id', b.buyer_id, 'label', b.label, 'persona', b.persona
    ) END,
    'estoppel_bundle', jsonb_build_object(
      'lien_status_verified', coalesce(d.lien_total, 0) = 0,
      'encumbrances_quantified', coalesce(d.lien_total, 0),
      'impact_days', CASE WHEN coalesce(d.lien_total, 0) = 0 THEN 2 ELSE 14 END
    ),
    'wiring', jsonb_build_object(
      'method', 'ACH/WIRE', 'rail', 'Bluevine Primary', 'emd_due_usd', 1000
    ),
    'terms', jsonb_build_object(
      'assignable', true, 'emd_non_refundable', true,
      'tif_window_minutes', 60, 'anti_circumvention_penalty_usd', 25000
    )
  );
END;
$$;

-- Offer a deal exclusively to a buy box for 60 minutes
CREATE OR REPLACE FUNCTION public.offer_deal_tif(_id uuid, _box_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _buyer uuid;
BEGIN
  SELECT buyer_id INTO _buyer FROM public.buyer_buy_boxes WHERE id = _box_id;
  UPDATE public.closing_pipeline_items
  SET matched_buyer_id = _buyer,
      tif_state = 'Pending_Signature',
      tif_expires_at = now() + interval '60 minutes',
      tif_dispatched_at = now(),
      tif_offered_buyer_ids = array_append(tif_offered_buyer_ids, _buyer),
      contract_payload = public.assemble_contract_payload(_id, _box_id),
      updated_at = now()
  WHERE id = _id;

  INSERT INTO public.system_audit_logs (pipeline_item_id, event_type, reason)
  VALUES (_id, 'TIF_OFFERED', 'Exclusive 60-minute execution window opened for buy box ' || _box_id::text);
END;
$$;

-- Cascade sweep: expire lapsed windows and re-offer to the next qualified buyer
CREATE OR REPLACE FUNCTION public.process_tif_expirations()
RETURNS TABLE(deal_id uuid, action text, next_buy_box uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _d record; _next uuid;
BEGIN
  FOR _d IN
    SELECT id, zip, base_contract_price, asset_type, tif_offered_buyer_ids, tif_cascade_count
    FROM public.closing_pipeline_items
    WHERE tif_state = 'Pending_Signature'
      AND tif_expires_at IS NOT NULL
      AND tif_expires_at < now()
    ORDER BY tif_expires_at
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.system_audit_logs (pipeline_item_id, event_type, reason)
    VALUES (_d.id, 'TIF_CASCADE_EXPIRED', 'Buyer failed to execute within 60-minute window');

    SELECT b.id INTO _next
    FROM public.buyer_buy_boxes b
    WHERE b.active
      AND NOT (b.buyer_id = ANY(_d.tif_offered_buyer_ids))
      AND (b.max_contract_price IS NULL OR coalesce(_d.base_contract_price,0) <= b.max_contract_price)
      AND (b.target_zip_codes IS NULL OR array_length(b.target_zip_codes,1) IS NULL OR _d.zip = ANY(b.target_zip_codes))
      AND (b.target_asset_types IS NULL OR array_length(b.target_asset_types,1) IS NULL OR _d.asset_type = ANY(b.target_asset_types))
    ORDER BY coalesce(b.urgency_score,0) DESC, coalesce(b.buyer_priority,0) DESC, b.created_at
    LIMIT 1;

    IF _next IS NOT NULL THEN
      UPDATE public.closing_pipeline_items
      SET tif_cascade_count = tif_cascade_count + 1 WHERE id = _d.id;
      PERFORM public.offer_deal_tif(_d.id, _next);
      deal_id := _d.id; action := 'cascaded'; next_buy_box := _next;
    ELSE
      UPDATE public.closing_pipeline_items
      SET tif_state = 'Expired', tif_expires_at = NULL, matched_buyer_id = NULL, updated_at = now()
      WHERE id = _d.id;
      deal_id := _d.id; action := 'released_to_tape'; next_buy_box := NULL;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Binding execution
CREATE OR REPLACE FUNCTION public.execute_buyer_contract(
  _id uuid, _signer_name text, _buyer_email text, _ip text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE d record; _fee numeric;
BEGIN
  SELECT * INTO d FROM public.closing_pipeline_items WHERE id = _id FOR UPDATE;
  IF d IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'deal_not_found'); END IF;
  IF d.tif_state = 'Executed' THEN
    RETURN jsonb_build_object('ok', true, 'already_executed', true, 'deal_id', _id);
  END IF;
  IF d.tif_expires_at IS NOT NULL AND d.tif_expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tif_expired');
  END IF;

  _fee := coalesce(d.optimized_acquisition_premium, greatest(coalesce(d.base_contract_price,0) * 0.05, 250));

  UPDATE public.closing_pipeline_items
  SET status = 'Buyer-Signed'::app_pipeline_status,
      tif_state = 'Executed',
      contract_payload = coalesce(contract_payload, public.assemble_contract_payload(_id, NULL)),
      updated_at = now()
  WHERE id = _id;

  INSERT INTO public.conversion_events (event, pipeline_item_id, buyer_email, channel, fee_amount, status, impact_days, lien_status_verified, tx_idempotency_key, metadata)
  VALUES ('contract_executed', _id, _buyer_email, 'sign_portal', _fee, 'pending',
          CASE WHEN coalesce(d.lien_total,0) = 0 THEN 2 ELSE 14 END,
          coalesce(d.lien_total,0) = 0,
          'exec_' || _id::text,
          jsonb_build_object('signer_name', _signer_name, 'signer_ip', _ip))
  ON CONFLICT (tx_idempotency_key) DO NOTHING;

  INSERT INTO public.system_audit_logs (pipeline_item_id, event_type, reason, to_status)
  VALUES (_id, 'CONTRACT_EXECUTED', 'One-click binding execution by ' || coalesce(_signer_name,'buyer'), 'Buyer-Signed');

  RETURN jsonb_build_object('ok', true, 'deal_id', _id, 'assignment_fee', _fee);
END;
$$;

SELECT cron.unschedule('process-tif-expirations') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-tif-expirations');
SELECT cron.schedule('process-tif-expirations', '* * * * *', $$SELECT public.process_tif_expirations();$$);
