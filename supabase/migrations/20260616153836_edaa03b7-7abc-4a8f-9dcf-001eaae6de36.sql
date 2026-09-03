CREATE TABLE public.processed_ledger_events (
  stripe_event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.processed_ledger_events TO service_role;

ALTER TABLE public.processed_ledger_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only" ON public.processed_ledger_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);