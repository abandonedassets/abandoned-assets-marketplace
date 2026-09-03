
CREATE TABLE public.dead_letter_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_payload jsonb NOT NULL,
  source_ip text,
  error_reason text,
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dead_letter_queue TO authenticated;
GRANT ALL ON public.dead_letter_queue TO service_role;

ALTER TABLE public.dead_letter_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on dead_letter_queue"
  ON public.dead_letter_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can view dead letter queue"
  ON public.dead_letter_queue FOR SELECT TO authenticated USING (true);

CREATE TRIGGER update_dead_letter_queue_updated_at
  BEFORE UPDATE ON public.dead_letter_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
