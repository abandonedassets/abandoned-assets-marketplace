ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS wire_instructions_status text,
  ADD COLUMN IF NOT EXISTS wire_instructions_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS wire_instructions_target text;

CREATE INDEX IF NOT EXISTS idx_cpi_wire_instructions_status
  ON public.closing_pipeline_items (wire_instructions_status);