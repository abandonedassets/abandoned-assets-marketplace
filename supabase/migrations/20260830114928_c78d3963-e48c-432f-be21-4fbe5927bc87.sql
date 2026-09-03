CREATE TABLE IF NOT EXISTS public.cash_deed_buyers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_name text NOT NULL,
  zip text NOT NULL,
  city text,
  state text,
  county text,
  deed_date date,
  purchase_amount numeric,
  is_cash boolean NOT NULL DEFAULT true,
  asset_hint text,
  source text NOT NULL DEFAULT 'unknown',
  source_url text,
  contact_email text,
  contact_phone text,
  purchases_90d integer NOT NULL DEFAULT 1,
  last_alerted_at timestamptz,
  alerts_sent integer NOT NULL DEFAULT 0,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_deed_buyers_uniq
  ON public.cash_deed_buyers (lower(buyer_name), zip);
CREATE INDEX IF NOT EXISTS cash_deed_buyers_zip_idx ON public.cash_deed_buyers (zip, deed_date DESC);

GRANT SELECT ON public.cash_deed_buyers TO authenticated;
GRANT ALL ON public.cash_deed_buyers TO service_role;

ALTER TABLE public.cash_deed_buyers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read cash deed buyers" ON public.cash_deed_buyers;
CREATE POLICY "admins read cash deed buyers"
  ON public.cash_deed_buyers FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS jv_partner_id uuid,
  ADD COLUMN IF NOT EXISTS jv_partner_name text,
  ADD COLUMN IF NOT EXISTS jv_partner_email text,
  ADD COLUMN IF NOT EXISTS jv_fee_split_pct numeric NOT NULL DEFAULT 0;