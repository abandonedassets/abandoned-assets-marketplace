CREATE TABLE public.internal_beneficiary_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE SET NULL,
  beneficiary_key text NOT NULL,
  beneficiary_label text NOT NULL,
  amount_usd numeric NOT NULL DEFAULT 0,
  pct numeric NOT NULL DEFAULT 0,
  reason text,
  status text NOT NULL DEFAULT 'accrued',
  settled_at timestamptz,
  external_transfer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_item_id, beneficiary_key)
);

GRANT SELECT ON public.internal_beneficiary_allocations TO authenticated;
GRANT ALL ON public.internal_beneficiary_allocations TO service_role;

ALTER TABLE public.internal_beneficiary_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view beneficiary allocations"
ON public.internal_beneficiary_allocations
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_iba_updated_at
BEFORE UPDATE ON public.internal_beneficiary_allocations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_iba_key_status ON public.internal_beneficiary_allocations (beneficiary_key, status);