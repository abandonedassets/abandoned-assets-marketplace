CREATE TABLE public.asset_encumbrances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid NOT NULL UNIQUE REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  hoa_dues_usd numeric NOT NULL DEFAULT 0,
  municipal_assessment_usd numeric NOT NULL DEFAULT 0,
  utility_lien_usd numeric NOT NULL DEFAULT 0,
  back_taxes_usd numeric NOT NULL DEFAULT 0,
  total_encumbrance_usd numeric NOT NULL DEFAULT 0,
  holdback_usd numeric NOT NULL DEFAULT 0,
  net_seller_payout_usd numeric,
  agreed_price_usd numeric,
  source text NOT NULL DEFAULT 'ESTOPPEL_API',
  estoppel_status text NOT NULL DEFAULT 'Pending',
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_encumbrances TO authenticated;
GRANT ALL ON public.asset_encumbrances TO service_role;

ALTER TABLE public.asset_encumbrances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage encumbrances"
ON public.asset_encumbrances FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_asset_encumbrances_updated_at
BEFORE UPDATE ON public.asset_encumbrances
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_asset_encumbrances_settled ON public.asset_encumbrances (settled_at);