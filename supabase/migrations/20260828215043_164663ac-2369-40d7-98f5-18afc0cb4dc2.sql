CREATE TABLE IF NOT EXISTS public.sovereign_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  buyer_ref text NOT NULL,
  stamp_micros bigint NOT NULL,
  mode text NOT NULL DEFAULT 'FIRM',
  state text NOT NULL DEFAULT 'LOCKED',
  fee_ack_hash text,
  reserved_capital_usd numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sovereign_reservations TO authenticated;
GRANT ALL ON public.sovereign_reservations TO service_role;

ALTER TABLE public.sovereign_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage sovereign reservations"
ON public.sovereign_reservations FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX IF NOT EXISTS sovereign_reservations_one_firm_lock
  ON public.sovereign_reservations (deal_id) WHERE state = 'LOCKED' AND mode = 'FIRM';

CREATE INDEX IF NOT EXISTS sovereign_reservations_deal_idx
  ON public.sovereign_reservations (deal_id, stamp_micros);

CREATE TRIGGER sovereign_reservations_updated_at
BEFORE UPDATE ON public.sovereign_reservations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Deterministic sequencer: first microsecond stamp wins the asset.
CREATE OR REPLACE FUNCTION public.sovereign_claim(
  _deal_id uuid, _buyer_ref text, _stamp_micros bigint, _mode text DEFAULT 'FIRM',
  _fee_ack_hash text DEFAULT NULL, _capital numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.sovereign_reservations; v_existing public.sovereign_reservations;
BEGIN
  SELECT * INTO v_existing FROM public.sovereign_reservations
   WHERE deal_id = _deal_id AND state = 'LOCKED' AND mode = 'FIRM' LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', 'ASSET_CLEARED',
      'winner_ref', v_existing.buyer_ref, 'winner_stamp_micros', v_existing.stamp_micros);
  END IF;

  INSERT INTO public.sovereign_reservations
    (deal_id, buyer_ref, stamp_micros, mode, fee_ack_hash, reserved_capital_usd)
  VALUES (_deal_id, _buyer_ref, _stamp_micros, COALESCE(_mode,'FIRM'), _fee_ack_hash, _capital)
  RETURNING * INTO v_row;

  IF v_row.mode = 'FIRM' THEN
    UPDATE public.closing_pipeline_items
       SET locked_at = now(), escrow_status = 'EMD_PENDING'
     WHERE id = _deal_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 200, 'reservation_id', v_row.id,
    'mode', v_row.mode, 'stamp_micros', v_row.stamp_micros);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'status', 409, 'error', 'ASSET_CLEARED');
END; $$;

-- Signature-hash state trigger: stamps the hash and strips the blocked state.
CREATE OR REPLACE FUNCTION public.sovereign_signature_unblock(_deal_id uuid, _hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status app_pipeline_status;
BEGIN
  UPDATE public.closing_pipeline_items
     SET signed_contract_hash = _hash,
         contract_state = CASE WHEN contract_state IN ('FULLY_EXECUTED','EMD_CLEARED')
                               THEN contract_state ELSE 'SELLER_SIGNED' END,
         erecording_blocked = false,
         status = CASE WHEN status IN ('Pending-Underwriting','System-Hold','Auto-Enrichment-Pending','New')
                       THEN 'Seller-Signed'::app_pipeline_status ELSE status END
   WHERE id = _deal_id
  RETURNING status INTO v_status;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'deal_not_found');
  END IF;

  -- Promote any conditional grey-pool reserve into a firm lock candidate.
  UPDATE public.sovereign_reservations
     SET state = 'ARMED'
   WHERE deal_id = _deal_id AND mode = 'CONDITIONAL' AND state = 'LOCKED';

  RETURN jsonb_build_object('ok', true, 'status', v_status, 'signature_hash', _hash);
END; $$;

GRANT EXECUTE ON FUNCTION public.sovereign_claim(uuid, text, bigint, text, text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.sovereign_signature_unblock(uuid, text) TO service_role;