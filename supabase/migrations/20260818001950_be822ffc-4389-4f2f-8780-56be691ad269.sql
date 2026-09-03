CREATE TABLE public.buyer_pof_verifications (
  id uuid primary key default gen_random_uuid(),
  esign_token text,
  pipeline_item_id uuid REFERENCES public.closing_pipeline_items(id) ON DELETE SET NULL,
  buyer_email text,
  required_usd numeric NOT NULL DEFAULT 0,
  available_usd numeric,
  institution_name text,
  account_mask text,
  status text NOT NULL DEFAULT 'pending',
  item_id text,
  access_token text,
  last_error text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pof_token ON public.buyer_pof_verifications (esign_token);
GRANT ALL ON public.buyer_pof_verifications TO service_role;
ALTER TABLE public.buyer_pof_verifications ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_pof_updated_at BEFORE UPDATE ON public.buyer_pof_verifications FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();