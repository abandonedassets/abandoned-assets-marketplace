CREATE TABLE public.dead_letter_payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'stripe',
  event_id text,
  raw_body text,
  headers jsonb,
  error_log text,
  status text NOT NULL DEFAULT 'PENDING_RETRY',
  retry_count integer NOT NULL DEFAULT 0,
  deal_id uuid,
  apn text,
  amount_cents bigint,
  stripe_reference_id text,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX dead_letter_payloads_event_unique ON public.dead_letter_payloads (source, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX dead_letter_payloads_status_idx ON public.dead_letter_payloads (status, created_at DESC);

GRANT SELECT ON public.dead_letter_payloads TO authenticated;
GRANT ALL ON public.dead_letter_payloads TO service_role;

ALTER TABLE public.dead_letter_payloads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read dead letter payloads"
ON public.dead_letter_payloads FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_dead_letter_payloads_updated_at
BEFORE UPDATE ON public.dead_letter_payloads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();