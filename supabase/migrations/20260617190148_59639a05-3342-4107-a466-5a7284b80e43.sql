
-- 1) Historical backfill: stamp escrow_pending_at for rows that have moved past
--    the escrow-pending gate but lack the timestamp. locked_at is the most
--    accurate proxy (set on transition into Locked-Escrow-Pending); fall back
--    to cleared_at minus 1 hour, then updated_at, then created_at.
UPDATE public.closing_pipeline_items
SET escrow_pending_at = COALESCE(
      locked_at,
      cleared_at - interval '1 hour',
      updated_at,
      created_at
    )
WHERE escrow_pending_at IS NULL
  AND status::text IN (
    'Locked-Escrow-Pending',
    'Funds-Cleared',
    'Closed',
    'Queued-For-Tomorrow',
    'System-Hold'
  );

-- 2) Penalty-weighted CVI: include System-Hold / dead-letter items as 168h.
CREATE OR REPLACE FUNCTION public.cvi_metrics()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cleared AS (
    SELECT cleared_at AS event_at,
           EXTRACT(EPOCH FROM (cleared_at - escrow_pending_at))/3600.0 AS hours
    FROM public.closing_pipeline_items
    WHERE cleared_at IS NOT NULL
      AND escrow_pending_at IS NOT NULL
      AND cleared_at >= now() - interval '14 days'
      AND cleared_at > escrow_pending_at
  ),
  penalty AS (
    -- DLQ / dead-letter pipeline items: full 168h penalty, attributed to
    -- updated_at (when they were quarantined). This prevents the CVI from
    -- silently looking healthier when ingestion degrades.
    SELECT updated_at AS event_at,
           168.0::numeric AS hours
    FROM public.closing_pipeline_items
    WHERE status::text = 'System-Hold'
      AND escrow_status = 'dead_letter'
      AND updated_at >= now() - interval '14 days'
  ),
  base AS (
    SELECT event_at, hours FROM cleared
    UNION ALL
    SELECT event_at, hours FROM penalty
  ),
  cur AS (
    SELECT AVG(hours) a, COUNT(*) c
    FROM base WHERE event_at >= now() - interval '7 days'
  ),
  prev AS (
    SELECT AVG(hours) a, COUNT(*) c
    FROM base
    WHERE event_at <  now() - interval '7 days'
      AND event_at >= now() - interval '14 days'
  ),
  days AS (
    SELECT gs::date AS d
    FROM generate_series((now() - interval '6 days')::date, now()::date, interval '1 day') gs
  ),
  daily AS (
    SELECT d.d AS day,
           COALESCE(AVG(b.hours), 0) AS avg_hours,
           COUNT(b.hours) AS n
    FROM days d
    LEFT JOIN base b ON date_trunc('day', b.event_at)::date = d.d
    GROUP BY d.d
    ORDER BY d.d
  )
  SELECT jsonb_build_object(
    'current_avg_hours', COALESCE((SELECT a FROM cur), 0),
    'current_sample',    COALESCE((SELECT c FROM cur), 0),
    'previous_avg_hours',COALESCE((SELECT a FROM prev), 0),
    'previous_sample',   COALESCE((SELECT c FROM prev), 0),
    'daily', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('day', day, 'avg_hours', avg_hours, 'n', n)) FROM daily),
      '[]'::jsonb
    ),
    'generated_at', now()
  );
$function$;
