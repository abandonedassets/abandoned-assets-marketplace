ALTER TABLE public.esign_requests
  ADD COLUMN IF NOT EXISTS w9_legal_name text,
  ADD COLUMN IF NOT EXISTS w9_tax_classification text,
  ADD COLUMN IF NOT EXISTS w9_tin_last4 text,
  ADD COLUMN IF NOT EXISTS w9_tin_hash text,
  ADD COLUMN IF NOT EXISTS w9_certified_at timestamptz;

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS compliance_tier text,
  ADD COLUMN IF NOT EXISTS erecording_blocked boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.audit_vault_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  esign_id uuid,
  pipeline_item_id uuid,
  object_key text NOT NULL,
  evidence_hash text,
  status text NOT NULL DEFAULT 'Pending',
  last_error text,
  exported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_vault_exports TO authenticated;
GRANT ALL ON public.audit_vault_exports TO service_role;
ALTER TABLE public.audit_vault_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_vault_admin_read" ON public.audit_vault_exports
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE UNIQUE INDEX IF NOT EXISTS audit_vault_exports_esign_uniq ON public.audit_vault_exports(esign_id);