CREATE TABLE public.gate_resolution_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid NOT NULL REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  gate text NOT NULL CHECK (gate IN ('CONTRACT','COUNTERPARTY','TITLE_ESCROW')),
  state text NOT NULL DEFAULT 'AUTO_DISPATCHING' CHECK (state IN ('AUTO_DISPATCHING','AWAITING_EXTERNAL_RESPONSE','RESOLVED','FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_detail text,
  external_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_item_id, gate)
);

GRANT SELECT ON public.gate_resolution_state TO authenticated;
GRANT ALL ON public.gate_resolution_state TO service_role;

ALTER TABLE public.gate_resolution_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view gate resolution state"
ON public.gate_resolution_state
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_grs_next_attempt ON public.gate_resolution_state (state, next_attempt_at);

CREATE TRIGGER update_gate_resolution_state_updated_at
BEFORE UPDATE ON public.gate_resolution_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();