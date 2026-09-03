DO $$ BEGIN
  CREATE TYPE public.offer_rejection_code AS ENUM ('YIELD_BELOW_HURDLE','LIEN_THRESHOLD_EXCEEDED','GEO_OUT_OF_BOUNDS','EMD_RAIL_MISMATCH','CAPITAL_SATURATED','CUSTOM_OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.offer_delivery_status AS ENUM ('DISPATCHED','DELIVERED','OPENED','CLICKED','REJECTED','EXECUTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.offer_delivery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid,
  buyer_id uuid,
  status public.offer_delivery_status NOT NULL,
  reason_code public.offer_rejection_code,
  ip_address text,
  user_agent text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.offer_delivery_logs TO authenticated;
GRANT ALL ON public.offer_delivery_logs TO service_role;
ALTER TABLE public.offer_delivery_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins read offer delivery logs" ON public.offer_delivery_logs
    FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_odl_contract ON public.offer_delivery_logs(contract_id);
CREATE INDEX IF NOT EXISTS idx_odl_created ON public.offer_delivery_logs(created_at DESC);

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS rejection_reason_code public.offer_rejection_code,
  ADD COLUMN IF NOT EXISTS rejection_target_price numeric,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

CREATE OR REPLACE FUNCTION public.reject_offer(
  _id uuid,
  _code public.offer_rejection_code,
  _target_price numeric DEFAULT NULL,
  _note text DEFAULT NULL,
  _source text DEFAULT 'ui',
  _ip text DEFAULT NULL,
  _user_agent text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.closing_pipeline_items%ROWTYPE;
  _next uuid;
BEGIN
  SELECT * INTO _row FROM public.closing_pipeline_items WHERE id = _id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  BEGIN
    UPDATE public.closing_pipeline_items
      SET status = 'Rejected',
          rejection_reason_code = _code,
          rejection_target_price = _target_price,
          rejected_at = now(),
          tif_state = 'Expired',
          tif_expires_at = NULL,
          updated_at = now()
      WHERE id = _id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  INSERT INTO public.offer_delivery_logs(contract_id, status, reason_code, ip_address, user_agent, meta)
  VALUES (_id, 'REJECTED', _code, _ip, _user_agent,
          jsonb_build_object('source', _source, 'note', _note, 'target_price', _target_price));

  -- Instant cascade: re-offer to next matched buy box (fail-forward).
  BEGIN
    SELECT buy_box_id INTO _next FROM public.compute_liquidity_match(_row) LIMIT 1;
    IF _next IS NOT NULL THEN
      PERFORM public.offer_deal_tif(_id, _next);
      INSERT INTO public.offer_delivery_logs(contract_id, buyer_id, status, meta)
      VALUES (_id, _next, 'DISPATCHED', jsonb_build_object('source','rejection_cascade'));
    END IF;
  EXCEPTION WHEN OTHERS THEN _next := NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'deal_id', _id, 'reason', _code, 'recascaded_to', _next);
END;
$$;

CREATE OR REPLACE FUNCTION public.offer_telemetry_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH l AS (SELECT * FROM public.offer_delivery_logs WHERE created_at > now() - interval '30 days')
  SELECT jsonb_build_object(
    'sent', (SELECT count(*) FROM l WHERE status IN ('DISPATCHED','DELIVERED')),
    'opened', (SELECT count(DISTINCT contract_id) FROM l WHERE status = 'OPENED'),
    'clicked', (SELECT count(DISTINCT contract_id) FROM l WHERE status = 'CLICKED'),
    'rejected', (SELECT count(*) FROM l WHERE status = 'REJECTED'),
    'executed', (SELECT count(*) FROM l WHERE status = 'EXECUTED'),
    'reasons', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT reason_code::text AS code, count(*) AS n
        FROM l WHERE status='REJECTED' AND reason_code IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 6) x), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.offer_telemetry_summary() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_offer(uuid, public.offer_rejection_code, numeric, text, text, text, text) TO service_role;