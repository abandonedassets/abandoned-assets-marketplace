DROP FUNCTION IF EXISTS public.scan_ledger_anomalies();
CREATE FUNCTION public.scan_ledger_anomalies()
RETURNS TABLE(out_code text, out_detected integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  CREATE TEMP TABLE _found (
    pipeline_item_id uuid,
    anomaly_code text,
    severity text,
    message text,
    details jsonb
  ) ON COMMIT DROP;

  INSERT INTO _found
  SELECT c.id, 'CLEARED_WITHOUT_STATE', 'critical',
         'Funds cleared timestamp present but deal state is ' || c.status::text,
         jsonb_build_object('cleared_at', c.cleared_at, 'cleared_amount', c.cleared_amount, 'status', c.status)
  FROM closing_pipeline_items c
  WHERE c.cleared_at IS NOT NULL AND c.status NOT IN ('Funds-Cleared','Closed');

  INSERT INTO _found
  SELECT c.id, 'PAYOUT_WITHOUT_CLEARANCE', 'critical',
         'Payout recorded without any funds-clearance record',
         jsonb_build_object('payout_at', c.payout_at, 'payout_transfer_id', c.payout_transfer_id)
  FROM closing_pipeline_items c
  WHERE c.payout_at IS NOT NULL AND c.cleared_at IS NULL;

  INSERT INTO _found
  SELECT c.id, 'ESCROW_PENDING_NO_STATUS', 'warning',
         'Escrow pending stamped but escrow_status is null',
         jsonb_build_object('escrow_pending_at', c.escrow_pending_at, 'status', c.status)
  FROM closing_pipeline_items c
  WHERE c.escrow_pending_at IS NOT NULL AND c.escrow_status IS NULL;

  INSERT INTO _found
  SELECT c.id, 'UNINSURABLE_IN_FLIGHT', 'critical',
         'Title marked Uninsurable while deal is still active in ' || c.status::text,
         jsonb_build_object('title_status', c.title_status, 'status', c.status, 'title_notes', c.title_notes)
  FROM closing_pipeline_items c
  WHERE c.title_status = 'Uninsurable'
    AND c.status IN ('In-Escrow','Locked-Escrow-Pending','Buyer-Signed','Seller-Signed','Funds-Cleared');

  INSERT INTO _found
  SELECT c.id, 'LIEN_VS_INSURED_TITLE', 'warning',
         'Lien balance recorded against a title marked Insured',
         jsonb_build_object('lien_total', c.lien_total, 'title_status', c.title_status)
  FROM closing_pipeline_items c
  WHERE COALESCE(c.lien_total,0) > 0 AND c.title_status = 'Insured';

  INSERT INTO _found
  SELECT c.id, 'TERMINATED_WITH_OPEN_ESCROW', 'critical',
         'Asset terminated (' || c.status::text || ') but escrow_status is ' || COALESCE(c.escrow_status,'null'),
         jsonb_build_object('status', c.status, 'escrow_status', c.escrow_status)
  FROM closing_pipeline_items c
  WHERE c.status IN ('Dead','Rejected','Auto_Archived_Bad_Data','Closed')
    AND c.escrow_status IS NOT NULL
    AND c.escrow_status NOT IN ('released','closed','void','cancelled');

  INSERT INTO _found
  SELECT c.id, 'LOCK_BY_INACTIVE_KEY', 'warning',
         'Deal locked by an API key that is no longer active',
         jsonb_build_object('locked_at', c.locked_at, 'locked_by_key_id', c.locked_by_key_id)
  FROM closing_pipeline_items c
  JOIN institutional_api_keys k ON k.id = c.locked_by_key_id
  WHERE c.locked_at IS NOT NULL AND k.is_active = false;

  INSERT INTO ledger_anomalies (pipeline_item_id, anomaly_code, severity, message, details)
  SELECT DISTINCT ON (f.pipeline_item_id, f.anomaly_code)
         f.pipeline_item_id, f.anomaly_code, f.severity, f.message, f.details
  FROM _found f
  ON CONFLICT (pipeline_item_id, anomaly_code) WHERE status = 'open'
  DO UPDATE SET last_detected_at = now(),
                severity = EXCLUDED.severity,
                message = EXCLUDED.message,
                details = EXCLUDED.details,
                updated_at = now();

  UPDATE ledger_anomalies la
  SET status = 'resolved', resolved_at = now(), updated_at = now()
  WHERE la.status = 'open'
    AND NOT EXISTS (
      SELECT 1 FROM _found f
      WHERE f.pipeline_item_id IS NOT DISTINCT FROM la.pipeline_item_id
        AND f.anomaly_code = la.anomaly_code
    );

  RETURN QUERY
  SELECT f.anomaly_code, COUNT(*)::integer FROM _found f GROUP BY f.anomaly_code;
END;
$$;

REVOKE ALL ON FUNCTION public.scan_ledger_anomalies() FROM public;
GRANT EXECUTE ON FUNCTION public.scan_ledger_anomalies() TO service_role;