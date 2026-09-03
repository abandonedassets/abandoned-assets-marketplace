CREATE TABLE IF NOT EXISTS public.app_secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON public.app_secrets FROM anon, authenticated;
GRANT ALL ON public.app_secrets TO service_role;
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (which bypasses RLS) may read or write.