
CREATE TABLE IF NOT EXISTS public.system_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  deal_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.system_alerts TO authenticated;
GRANT ALL ON public.system_alerts TO service_role;
ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read alerts" ON public.system_alerts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service role full alerts" ON public.system_alerts FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS system_alerts_created_idx ON public.system_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS system_alerts_kind_idx ON public.system_alerts(kind);

-- Zero-touch auto-clear: clears eligible Locked-Escrow-Pending assets.
CREATE OR REPLACE FUNCTION public.auto_clear_eligible_deals()
RETURNS TABLE(deal_id UUID, cleared_amount NUMERIC, zip TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _r RECORD; _amt NUMERIC; _evt TEXT;
BEGIN
  FOR _r IN
    SELECT id, zip, optimized_acquisition_premium, locked_at
    FROM public.closing_pipeline_items
    WHERE status = 'Locked-Escrow-Pending'::app_pipeline_status
      AND COALESCE(manual_review,false) = false
      AND COALESCE(is_stale,false) = false
      AND COALESCE(confidence_score,0) >= 50
      AND locked_at IS NOT NULL
      AND locked_at < now() - interval '30 seconds'
    FOR UPDATE SKIP LOCKED
  LOOP
    _amt := COALESCE(_r.optimized_acquisition_premium, 0);
    _evt := 'auto_clear:' || _r.id::text || ':' || extract(epoch from now())::bigint;
    UPDATE public.closing_pipeline_items SET
      status = 'Funds-Cleared'::app_pipeline_status,
      escrow_status = 'cleared',
      cleared_at = now(),
      cleared_amount = _amt,
      lock_expires_at = NULL,
      is_stale = false,
      updated_at = now()
    WHERE id = _r.id;
    INSERT INTO public.processed_ledger_events(event_id) VALUES (_evt)
      ON CONFLICT DO NOTHING;
    deal_id := _r.id; cleared_amount := _amt; zip := _r.zip;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- EOD digest function
CREATE OR REPLACE FUNCTION public.eod_settlement_summary(_hours INTEGER DEFAULT 24)
RETURNS JSONB
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH win AS (
    SELECT * FROM public.closing_pipeline_items
    WHERE cleared_at IS NOT NULL
      AND cleared_at >= now() - make_interval(hours => _hours)
  ),
  by_zip AS (
    SELECT zip, COUNT(*) AS n, SUM(COALESCE(cleared_amount, optimized_acquisition_premium)) AS usd
    FROM win GROUP BY zip ORDER BY usd DESC NULLS LAST LIMIT 10
  )
  SELECT jsonb_build_object(
    'window_hours', _hours,
    'generated_at', now(),
    'total_cleared_usd', COALESCE((SELECT SUM(COALESCE(cleared_amount, optimized_acquisition_premium)) FROM win), 0),
    'cleared_count', (SELECT COUNT(*) FROM win),
    'avg_settlement_latency_ms', (
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (cleared_at - locked_at)) * 1000), 0)::bigint
      FROM win WHERE locked_at IS NOT NULL
    ),
    'by_zip', COALESCE((SELECT jsonb_agg(jsonb_build_object('zip', zip, 'count', n, 'usd', usd)) FROM by_zip), '[]'::jsonb)
  );
$$;
