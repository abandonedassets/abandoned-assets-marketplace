-- Master Command Engine: routing + diagnostic log
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS active_owner text,
  ADD COLUMN IF NOT EXISTS partner_share numeric,
  ADD COLUMN IF NOT EXISTS routing_rule text;

CREATE TABLE IF NOT EXISTS public.system_diagnostic_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid,
  active_owner text NOT NULL,
  fee numeric,
  partner_share numeric,
  rule text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_diagnostic_log TO authenticated;
GRANT ALL    ON public.system_diagnostic_log TO service_role;
ALTER TABLE public.system_diagnostic_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "diag_admin_read" ON public.system_diagnostic_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_sdl_created_at ON public.system_diagnostic_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sdl_owner      ON public.system_diagnostic_log(active_owner);

-- Routing trigger
CREATE OR REPLACE FUNCTION public.route_and_assign_asset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _fee numeric := COALESCE(NEW.optimized_acquisition_premium, 0);
  _last_hex text;
  _parity int;
  _owner text;
  _rule text;
  _share numeric := 0;
BEGIN
  IF _fee >= 100000 THEN
    _owner := 'Master';
    _rule  := 'Routing: Fee>=100k Whale-Class -> Master Assigned';
  ELSE
    _last_hex := lower(substr(NEW.id::text, length(NEW.id::text), 1));
    _parity := ('x' || _last_hex)::bit(4)::int % 2;
    IF _parity = 1 THEN
      _owner := 'Partner';
      _rule  := 'Routing: Odd-ID Partition -> Partner Assigned';
      _share := round(_fee * 0.50, 2);
    ELSE
      _owner := 'Master';
      _rule  := 'Routing: Even-ID Partition -> Master Assigned';
      _share := round(_fee * 0.50, 2);
    END IF;
  END IF;

  NEW.active_owner  := _owner;
  NEW.partner_share := CASE WHEN _owner = 'Partner' THEN _share ELSE 0 END;
  NEW.routing_rule  := _rule;

  BEGIN
    INSERT INTO public.system_diagnostic_log(
      pipeline_item_id, active_owner, fee, partner_share, rule, metadata
    ) VALUES (
      NEW.id, _owner, _fee, NEW.partner_share, _rule,
      jsonb_build_object('zip', NEW.zip, 'price', NEW.base_contract_price)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_route_and_assign_asset ON public.closing_pipeline_items;
CREATE TRIGGER trg_route_and_assign_asset
  BEFORE INSERT ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.route_and_assign_asset();

-- Backfill the 93 existing contracts deterministically
UPDATE public.closing_pipeline_items c SET
  active_owner = sub.owner,
  partner_share = sub.share,
  routing_rule = sub.rule
FROM (
  SELECT id,
    CASE
      WHEN COALESCE(optimized_acquisition_premium,0) >= 100000 THEN 'Master'
      WHEN ('x' || lower(substr(id::text, length(id::text), 1)))::bit(4)::int % 2 = 1 THEN 'Partner'
      ELSE 'Master'
    END AS owner,
    CASE
      WHEN COALESCE(optimized_acquisition_premium,0) >= 100000 THEN 0
      WHEN ('x' || lower(substr(id::text, length(id::text), 1)))::bit(4)::int % 2 = 1
        THEN round(COALESCE(optimized_acquisition_premium,0) * 0.50, 2)
      ELSE round(COALESCE(optimized_acquisition_premium,0) * 0.50, 2)
    END AS share,
    CASE
      WHEN COALESCE(optimized_acquisition_premium,0) >= 100000
        THEN 'Routing: Fee>=100k Whale-Class -> Master Assigned (backfill)'
      WHEN ('x' || lower(substr(id::text, length(id::text), 1)))::bit(4)::int % 2 = 1
        THEN 'Routing: Odd-ID Partition -> Partner Assigned (backfill)'
      ELSE 'Routing: Even-ID Partition -> Master Assigned (backfill)'
    END AS rule
  FROM public.closing_pipeline_items
  WHERE active_owner IS NULL
) sub
WHERE c.id = sub.id;

-- Mission-control telemetry RPC
CREATE OR REPLACE FUNCTION public.mission_control_pulse()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH win AS (
    SELECT * FROM public.closing_pipeline_items
    WHERE created_at >= now() - interval '60 minutes'
  ),
  match_lat AS (
    SELECT EXTRACT(EPOCH FROM (locked_at - created_at))*1000 AS ms
    FROM public.closing_pipeline_items
    WHERE locked_at IS NOT NULL
      AND locked_at >= now() - interval '24 hours'
      AND locked_at > created_at
  ),
  errs AS (
    SELECT count(*) FILTER (WHERE error_reason ~* '429') AS e429,
           count(*) FILTER (WHERE error_reason ~* '401|403') AS eauth,
           count(*) AS total
    FROM public.dead_letter_queue
    WHERE created_at >= now() - interval '24 hours'
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'total_contracts', (SELECT count(*) FROM public.closing_pipeline_items),
    'master_count',  (SELECT count(*) FROM public.closing_pipeline_items WHERE active_owner='Master'),
    'partner_count', (SELECT count(*) FROM public.closing_pipeline_items WHERE active_owner='Partner'),
    'partner_share_total', (SELECT COALESCE(SUM(partner_share),0) FROM public.closing_pipeline_items),
    'apm_last_60m', ROUND((SELECT count(*) FROM win)::numeric / 60.0, 2),
    'matching_latency_ms_avg', COALESCE((SELECT AVG(ms) FROM match_lat),0)::bigint,
    'matching_latency_ms_p95', COALESCE((SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) FROM match_lat),0)::bigint,
    'error_vector_429', (SELECT e429 FROM errs),
    'error_vector_auth', (SELECT eauth FROM errs),
    'error_vector_total', (SELECT total FROM errs),
    'recent_routes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'at', created_at, 'owner', active_owner, 'fee', fee,
        'partner_share', partner_share, 'rule', rule
      ) ORDER BY created_at DESC)
      FROM (SELECT * FROM public.system_diagnostic_log ORDER BY created_at DESC LIMIT 25) r
    ),'[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.mission_control_pulse() TO authenticated;