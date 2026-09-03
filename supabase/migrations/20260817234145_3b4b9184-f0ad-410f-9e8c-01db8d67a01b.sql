CREATE TABLE public.ledger_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  anomaly_code text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ledger_anomalies_unique_open
  ON public.ledger_anomalies (pipeline_item_id, anomaly_code)
  WHERE status = 'open';
CREATE INDEX ledger_anomalies_status_idx ON public.ledger_anomalies (status, severity, last_detected_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ledger_anomalies TO authenticated;
GRANT ALL ON public.ledger_anomalies TO service_role;

ALTER TABLE public.ledger_anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read anomalies" ON public.ledger_anomalies
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update anomalies" ON public.ledger_anomalies
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_ledger_anomalies_updated_at
  BEFORE UPDATE ON public.ledger_anomalies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.scan_ledger_anomalies()
RETURNS TABLE(anomaly_code text, detected integer)
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

  -- 1. Cleared timestamp/amount without a cleared state.
  INSERT INTO _found
  SELECT c.id, 'CLEARED_WITHOUT_STATE', 'critical',
         'Funds cleared timestamp present but deal state is ' || c.status::text,
         jsonb_build_object('cleared_at', c.cleared_at, 'cleared_amount', c.cleared_amount, 'status', c.status)
  FROM closing_pipeline_items c
  WHERE c.cleared_at IS NOT NULL
    AND c.status NOT IN ('Funds-Cleared','Closed');

  -- 2. Payout recorded with no clearance event.
  INSERT INTO _found
  SELECT c.id, 'PAYOUT_WITHOUT_CLEARANCE', 'critical',
         'Payout recorded without any funds-clearance record',
         jsonb_build_object('payout_at', c.payout_at, 'payout_transfer_id', c.payout_transfer_id)
  FROM closing_pipeline_items c
  WHERE c.payout_at IS NOT NULL AND c.cleared_at IS NULL;

  -- 3. Escrow pending stamp with no escrow status.
  INSERT INTO _found
  SELECT c.id, 'ESCROW_PENDING_NO_STATUS', 'warning',
         'Escrow pending stamped but escrow_status is null',
         jsonb_build_object('escrow_pending_at', c.escrow_pending_at, 'status', c.status)
  FROM closing_pipeline_items c
  WHERE c.escrow_pending_at IS NOT NULL AND c.escrow_status IS NULL;

  -- 4. Uninsurable title still progressing.
  INSERT INTO _found
  SELECT c.id, 'UNINSURABLE_IN_FLIGHT', 'critical',
         'Title marked Uninsurable while deal is still active in ' || c.status::text,
         jsonb_build_object('title_status', c.title_status, 'status', c.status, 'title_notes', c.title_notes)
  FROM closing_pipeline_items c
  WHERE c.title_status = 'Uninsurable'
    AND c.status IN ('In-Escrow','Locked-Escrow-Pending','Buyer-Signed','Seller-Signed','Funds-Cleared');

  -- 5. Liens outstanding against an insured title.
  INSERT INTO _found
  SELECT c.id, 'LIEN_VS_INSURED_TITLE', 'warning',
         'Lien balance recorded against a title marked Insured',
         jsonb_build_object('lien_total', c.lien_total, 'title_status', c.title_status)
  FROM closing_pipeline_items c
  WHERE COALESCE(c.lien_total,0) > 0 AND c.title_status = 'Insured';

  -- 6. Terminated/dead asset still holding an open escrow.
  INSERT INTO _found
  SELECT c.id, 'TERMINATED_WITH_OPEN_ESCROW', 'critical',
         'Asset terminated (' || c.status::text || ') but escrow_status is ' || COALESCE(c.escrow_status,'null'),
         jsonb_build_object('status', c.status, 'escrow_status', c.escrow_status)
  FROM closing_pipeline_items c
  WHERE c.status IN ('Dead','Rejected','Auto_Archived_Bad_Data','Closed')
    AND c.escrow_status IS NOT NULL
    AND c.escrow_status NOT IN ('released','closed','void','cancelled');

  -- 7. Locked by a key that is no longer active.
  INSERT INTO _found
  SELECT c.id, 'LOCK_BY_INACTIVE_KEY', 'warning',
         'Deal locked by an API key that is no longer active',
         jsonb_build_object('locked_at', c.locked_at, 'locked_by_key_id', c.locked_by_key_id)
  FROM closing_pipeline_items c
  JOIN institutional_api_keys k ON k.id = c.locked_by_key_id
  WHERE c.locked_at IS NOT NULL AND k.is_active = false;

  -- Upsert open anomalies.
  INSERT INTO ledger_anomalies (pipeline_item_id, anomaly_code, severity, message, details)
  SELECT DISTINCT ON (pipeline_item_id, anomaly_code)
         pipeline_item_id, anomaly_code, severity, message, details
  FROM _found
  ON CONFLICT (pipeline_item_id, anomaly_code) WHERE status = 'open'
  DO UPDATE SET last_detected_at = now(),
                severity = EXCLUDED.severity,
                message = EXCLUDED.message,
                details = EXCLUDED.details,
                updated_at = now();

  -- Auto-resolve anomalies that no longer reproduce.
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