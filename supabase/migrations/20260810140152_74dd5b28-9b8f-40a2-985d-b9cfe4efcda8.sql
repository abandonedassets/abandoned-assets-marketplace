ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS data_fidelity_score numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS m2m_asset_hash text;

CREATE OR REPLACE FUNCTION public.cpi_stamp_m2m_fidelity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s numeric := 0.5;
BEGIN
  IF NEW.apn IS NOT NULL AND length(NEW.apn) > 3 THEN s := s + 0.25; END IF;
  IF NEW.has_signed_marketing_auth THEN s := s + 0.2; END IF;
  IF NEW.owner_entity IS NOT NULL THEN s := s + 0.05; END IF;
  IF NEW.assessed_value IS NOT NULL AND NEW.assessed_value > 0 THEN s := s + 0.05; END IF;
  IF NEW.title_status = 'Insured'::title_status_enum THEN s := s + 0.05; END IF;
  IF NEW.source = 'manual' THEN s := s - 0.1; END IF;
  NEW.data_fidelity_score := LEAST(1.00, GREATEST(0.00, round(s, 2)));

  NEW.m2m_asset_hash := encode(digest(
    coalesce(NEW.apn, coalesce(NEW.address,'') || '|' || coalesce(NEW.zip,'')) || '|' ||
    coalesce(NEW.base_contract_price, 0)::text || '|' ||
    coalesce(NEW.has_signed_marketing_auth, false)::text, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_stamp_m2m_fidelity ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_stamp_m2m_fidelity
BEFORE INSERT OR UPDATE OF apn, address, zip, base_contract_price, has_signed_marketing_auth, title_status, assessed_value, owner_entity
ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.cpi_stamp_m2m_fidelity();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_cpi_m2m_asset_hash
  ON public.closing_pipeline_items (m2m_asset_hash)
  WHERE m2m_asset_hash IS NOT NULL AND cleared_at IS NULL;

CREATE TABLE IF NOT EXISTS public.c2c_capital_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid NOT NULL REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  api_key_id uuid REFERENCES public.institutional_api_keys(id),
  buyer_reference text,
  committed_usd numeric NOT NULL DEFAULT 0,
  stripe_payment_intent_id text,
  status text NOT NULL DEFAULT 'committed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.c2c_capital_pool TO service_role;
ALTER TABLE public.c2c_capital_pool ENABLE ROW LEVEL SECURITY;
CREATE POLICY "c2c pool admin read" ON public.c2c_capital_pool
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.c2c_capital_pool TO authenticated;

CREATE TRIGGER update_c2c_capital_pool_updated_at
BEFORE UPDATE ON public.c2c_capital_pool
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_c2c_pool_item ON public.c2c_capital_pool (pipeline_item_id);