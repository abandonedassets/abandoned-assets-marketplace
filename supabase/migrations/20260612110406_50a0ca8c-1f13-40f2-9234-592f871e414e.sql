
CREATE TYPE public.title_package_status AS ENUM (
  'Queued','Built','Sent','Acknowledged','Failed'
);

-- routing_endpoints
CREATE TABLE public.routing_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  priority_score NUMERIC(8,4) NOT NULL DEFAULT 1.0,
  last_dispatched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.routing_endpoints TO authenticated;
GRANT ALL ON public.routing_endpoints TO service_role;

ALTER TABLE public.routing_endpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage routing endpoints"
  ON public.routing_endpoints FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_routing_endpoints_updated_at
  BEFORE UPDATE ON public.routing_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- routing_dispatch_log
CREATE TABLE public.routing_dispatch_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES public.routing_endpoints(id) ON DELETE CASCADE,
  pipeline_item_id UUID NOT NULL REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  http_status INTEGER,
  latency_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  error_text TEXT,
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.routing_dispatch_log TO authenticated;
GRANT ALL ON public.routing_dispatch_log TO service_role;

ALTER TABLE public.routing_dispatch_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view dispatch log"
  ON public.routing_dispatch_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_dispatch_log_endpoint_time
  ON public.routing_dispatch_log(endpoint_id, dispatched_at DESC);
CREATE INDEX idx_dispatch_log_item
  ON public.routing_dispatch_log(pipeline_item_id);

-- title_packages
CREATE TABLE public.title_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id UUID NOT NULL UNIQUE
    REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  package_status public.title_package_status NOT NULL DEFAULT 'Queued',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  title_company_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.title_packages TO authenticated;
GRANT ALL ON public.title_packages TO service_role;

ALTER TABLE public.title_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage title packages"
  ON public.title_packages FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_title_packages_updated_at
  BEFORE UPDATE ON public.title_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Required extensions for pg_cron scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
