CREATE TABLE IF NOT EXISTS public.processed_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_key text NOT NULL,
  command_type text NOT NULL DEFAULT 'generic',
  source text,
  deal_id uuid,
  payload_hash text,
  result jsonb,
  status text NOT NULL DEFAULT 'CLAIMED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT processed_commands_execution_key_unique UNIQUE (execution_key)
);

CREATE INDEX IF NOT EXISTS idx_processed_commands_created_at ON public.processed_commands (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_processed_commands_deal ON public.processed_commands (deal_id);

GRANT ALL ON public.processed_commands TO service_role;
GRANT SELECT ON public.processed_commands TO authenticated;

ALTER TABLE public.processed_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view processed commands"
ON public.processed_commands FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_processed_commands_updated_at ON public.processed_commands;
CREATE TRIGGER update_processed_commands_updated_at
BEFORE UPDATE ON public.processed_commands
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Atomic single-winner claim. Returns claimed=false when the key already exists.
CREATE OR REPLACE FUNCTION public.claim_command(
  _execution_key text,
  _command_type text DEFAULT 'generic',
  _source text DEFAULT NULL,
  _deal_id uuid DEFAULT NULL,
  _payload_hash text DEFAULT NULL
)
RETURNS TABLE(claimed boolean, command_id uuid, first_seen_at timestamptz, prior_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.processed_commands (execution_key, command_type, source, deal_id, payload_hash)
  VALUES (_execution_key, _command_type, _source, _deal_id, _payload_hash)
  ON CONFLICT (execution_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT true, v_id, now(), NULL::text;
  ELSE
    RETURN QUERY
      SELECT false, pc.id, pc.created_at, pc.status
      FROM public.processed_commands pc
      WHERE pc.execution_key = _execution_key;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_command(
  _execution_key text,
  _status text,
  _result jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.processed_commands
  SET status = _status, result = COALESCE(_result, result), updated_at = now()
  WHERE execution_key = _execution_key;
$$;

REVOKE ALL ON FUNCTION public.claim_command(text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_command(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_command(text, text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_command(text, text, jsonb) TO service_role;