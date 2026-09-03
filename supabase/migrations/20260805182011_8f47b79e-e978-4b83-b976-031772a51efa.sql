ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS tif_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS tif_state text,
  ADD COLUMN IF NOT EXISTS tif_dispatched_at timestamptz;

CREATE TABLE IF NOT EXISTS public.m2m_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE SET NULL,
  api_key_id uuid REFERENCES public.institutional_api_keys(id) ON DELETE SET NULL,
  buyer_reference text,
  vdr_token text,
  signature_hash text,
  stripe_customer_id text,
  stripe_payment_intent_id text,
  amount_usd numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Received',
  latency_ms integer,
  tif_remaining_ms integer,
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.m2m_executions TO authenticated;
GRANT ALL ON public.m2m_executions TO service_role;
ALTER TABLE public.m2m_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "m2m_executions_admin_read" ON public.m2m_executions;
CREATE POLICY "m2m_executions_admin_read" ON public.m2m_executions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS m2m_executions_created_idx ON public.m2m_executions (created_at DESC);
CREATE INDEX IF NOT EXISTS cpi_tif_idx ON public.closing_pipeline_items (tif_expires_at) WHERE tif_expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sweep_expired_tif()
RETURNS TABLE(deal_id uuid, prior_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH expired AS (
    SELECT id, status::text AS s
    FROM public.closing_pipeline_items
    WHERE tif_expires_at IS NOT NULL
      AND tif_expires_at < now()
      AND coalesce(tif_state, '') NOT IN ('Executed', 'Expired')
    LIMIT 500
  ), upd AS (
    UPDATE public.closing_pipeline_items c
    SET status = 'Scout',
        tif_state = 'Expired',
        tif_expires_at = NULL,
        updated_at = now()
    FROM expired e
    WHERE c.id = e.id
    RETURNING c.id, e.s
  ), logged AS (
    INSERT INTO public.system_audit_logs (pipeline_item_id, event_type, reason, from_status, to_status)
    SELECT u.id, 'TIF_EXPIRED', 'M2M execution window lapsed — asset degraded to public tape', u.s, 'Scout'
    FROM upd u
    RETURNING 1
  )
  SELECT u.id, u.s FROM upd u;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_expired_tif() FROM PUBLIC, anon, authenticated;