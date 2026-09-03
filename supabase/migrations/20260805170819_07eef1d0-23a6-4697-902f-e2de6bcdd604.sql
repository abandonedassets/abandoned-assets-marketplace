CREATE TABLE IF NOT EXISTS public.resilient_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_url text NOT NULL,
  method text NOT NULL DEFAULT 'POST',
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  kind text NOT NULL DEFAULT 'dispatch',
  pipeline_item_id uuid,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status integer,
  last_error text,
  delivered_at timestamptz,
  abandoned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.resilient_outbox TO service_role;
GRANT SELECT ON public.resilient_outbox TO authenticated;

ALTER TABLE public.resilient_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read outbox" ON public.resilient_outbox;
CREATE POLICY "admins read outbox" ON public.resilient_outbox
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS resilient_outbox_pending_idx
  ON public.resilient_outbox (next_attempt_at)
  WHERE delivered_at IS NULL AND abandoned_at IS NULL;

DROP TRIGGER IF EXISTS trg_resilient_outbox_updated_at ON public.resilient_outbox;
CREATE TRIGGER trg_resilient_outbox_updated_at
  BEFORE UPDATE ON public.resilient_outbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();