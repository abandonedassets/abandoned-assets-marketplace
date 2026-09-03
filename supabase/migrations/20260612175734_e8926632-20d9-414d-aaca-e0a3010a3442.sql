
CREATE TABLE public.institutional_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  rate_limit_per_minute integer NOT NULL DEFAULT 60,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.institutional_api_keys TO authenticated;
GRANT ALL ON public.institutional_api_keys TO service_role;

ALTER TABLE public.institutional_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage api keys"
ON public.institutional_api_keys FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_institutional_api_keys_updated
BEFORE UPDATE ON public.institutional_api_keys
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.institutional_api_request_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid REFERENCES public.institutional_api_keys(id) ON DELETE SET NULL,
  endpoint text NOT NULL,
  http_status integer NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_req_log_key_time ON public.institutional_api_request_log(api_key_id, requested_at DESC);

GRANT SELECT ON public.institutional_api_request_log TO authenticated;
GRANT ALL ON public.institutional_api_request_log TO service_role;

ALTER TABLE public.institutional_api_request_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view api request log"
ON public.institutional_api_request_log FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
