
-- Module 2: Idempotency-key table for ingest dedup
CREATE TABLE IF NOT EXISTS public.ingest_idempotency_keys (
  hash text PRIMARY KEY,
  source text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ingest_idempotency_keys TO authenticated;
GRANT ALL ON public.ingest_idempotency_keys TO service_role;
ALTER TABLE public.ingest_idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages idempotency"
  ON public.ingest_idempotency_keys
  TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "admin reads idempotency"
  ON public.ingest_idempotency_keys
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Module 3 & 4: delta sync + self-healing flags
INSERT INTO public.system_flags(key, text_value, updated_at)
VALUES ('ingest_last_sync_ts', NULL, now())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.system_flags(key, int_value, updated_at)
VALUES ('ingest_batch_size', 50, now())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.system_flags(key, int_value, updated_at)
VALUES ('ingest_min_interval_seconds', 60, now())
ON CONFLICT (key) DO NOTHING;
