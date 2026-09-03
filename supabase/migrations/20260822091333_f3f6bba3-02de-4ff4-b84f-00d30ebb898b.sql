CREATE TABLE IF NOT EXISTS public.dispatch_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL DEFAULT 'LENDER_SYNDICATION',
  endpoint_name text,
  endpoint_url text,
  http_status integer NOT NULL DEFAULT 0,
  ok boolean NOT NULL DEFAULT false,
  latency_ms integer NOT NULL DEFAULT 0,
  detail text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dispatch_logs TO authenticated;
GRANT ALL ON public.dispatch_logs TO service_role;

ALTER TABLE public.dispatch_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read dispatch logs"
ON public.dispatch_logs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_dispatch_logs_created_at ON public.dispatch_logs (created_at DESC);