ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS has_signed_marketing_auth boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_auth_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS title_company_of_record jsonb;

CREATE INDEX IF NOT EXISTS idx_cpi_marketing_auth
  ON public.closing_pipeline_items (has_signed_marketing_auth)
  WHERE has_signed_marketing_auth = true;

INSERT INTO public.system_config (key, value)
VALUES ('title_company_of_record', '{"name":null,"escrow_officer":null,"email":null,"phone":null,"wire_instructions_verified":false,"emd_destination":null}'::jsonb)
ON CONFLICT (key) DO NOTHING;