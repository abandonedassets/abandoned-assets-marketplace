CREATE TABLE IF NOT EXISTS public.institutional_buy_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_name text NOT NULL,
  min_beds integer NOT NULL DEFAULT 3,
  min_baths numeric NOT NULL DEFAULT 2,
  min_sqft integer NOT NULL DEFAULT 0,
  min_year_built integer NOT NULL DEFAULT 1990,
  requires_garage boolean NOT NULL DEFAULT false,
  max_hoa_monthly numeric NOT NULL DEFAULT 50,
  max_repair_budget numeric NOT NULL DEFAULT 25000,
  min_cap_rate numeric NOT NULL DEFAULT 0.07,
  target_zips text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.institutional_buy_boxes TO authenticated;
GRANT ALL ON public.institutional_buy_boxes TO service_role;
ALTER TABLE public.institutional_buy_boxes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage institutional buy boxes" ON public.institutional_buy_boxes;
CREATE POLICY "Admins manage institutional buy boxes"
ON public.institutional_buy_boxes FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_ibb_updated_at ON public.institutional_buy_boxes;
CREATE TRIGGER trg_ibb_updated_at BEFORE UPDATE ON public.institutional_buy_boxes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS matched_fund_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS estimated_cap_rate numeric,
  ADD COLUMN IF NOT EXISTS has_garage boolean,
  ADD COLUMN IF NOT EXISTS hoa_monthly numeric;

CREATE INDEX IF NOT EXISTS idx_cpi_matched_fund_ids ON public.closing_pipeline_items USING GIN (matched_fund_ids);

ALTER TABLE public.institutional_api_keys
  ADD COLUMN IF NOT EXISTS fund_id uuid REFERENCES public.institutional_buy_boxes(id) ON DELETE SET NULL;