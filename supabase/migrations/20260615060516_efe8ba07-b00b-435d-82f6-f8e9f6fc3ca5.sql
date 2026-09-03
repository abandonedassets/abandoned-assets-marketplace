
CREATE TABLE public.system_flags (
  key TEXT PRIMARY KEY,
  bool_value BOOLEAN,
  int_value INTEGER,
  text_value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.system_flags TO authenticated;
GRANT ALL ON public.system_flags TO service_role;
ALTER TABLE public.system_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage system_flags" ON public.system_flags FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "authenticated read system_flags" ON public.system_flags FOR SELECT
  USING (auth.role() = 'authenticated');

INSERT INTO public.system_flags (key, bool_value, int_value)
VALUES ('ingest_enabled', true, NULL), ('ingest_daily_cap', NULL, 5)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE public.ingest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  total_rows INTEGER DEFAULT 0,
  inserted INTEGER DEFAULT 0,
  deduped INTEGER DEFAULT 0,
  dlq INTEGER DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ingest_runs_created_at_idx ON public.ingest_runs (created_at DESC);
GRANT SELECT ON public.ingest_runs TO authenticated;
GRANT ALL ON public.ingest_runs TO service_role;
ALTER TABLE public.ingest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read ingest_runs" ON public.ingest_runs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));
