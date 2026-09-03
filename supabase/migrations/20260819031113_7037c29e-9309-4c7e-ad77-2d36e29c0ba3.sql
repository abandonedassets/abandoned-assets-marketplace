CREATE TABLE IF NOT EXISTS public.outbound_dispatch_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,
  pipeline_item_id uuid,
  channel text NOT NULL DEFAULT 'email',
  target text NOT NULL,
  subject text,
  html text,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  not_before timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued',
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_odq_due ON public.outbound_dispatch_queue (status, not_before);

GRANT ALL ON public.outbound_dispatch_queue TO service_role;
ALTER TABLE public.outbound_dispatch_queue ENABLE ROW LEVEL SECURITY;
