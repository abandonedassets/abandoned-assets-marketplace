
DO $$ BEGIN
  CREATE TYPE public.cre_asset_class AS ENUM (
    'MULTIFAMILY_5PLUS','LIGHT_INDUSTRIAL','NNN_RETAIL','FLEX_STORAGE','COMMERCIAL_LAND','NON_COMMERCIAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS cre_class public.cre_asset_class,
  ADD COLUMN IF NOT EXISTS fee_bps integer,
  ADD COLUMN IF NOT EXISTS expense_ratio numeric,
  ADD COLUMN IF NOT EXISTS walt_years numeric,
  ADD COLUMN IF NOT EXISTS tenant_credit_tier text,
  ADD COLUMN IF NOT EXISTS debt_maturity_date date,
  ADD COLUMN IF NOT EXISTS debt_distress_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS debt_distress_reason text,
  ADD COLUMN IF NOT EXISTS far_potential numeric,
  ADD COLUMN IF NOT EXISTS adaptive_reuse_by_right boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cre_lane text;

CREATE INDEX IF NOT EXISTS idx_cpi_cre_class ON public.closing_pipeline_items (cre_class);
CREATE INDEX IF NOT EXISTS idx_cpi_cre_lane ON public.closing_pipeline_items (cre_lane);
CREATE INDEX IF NOT EXISTS idx_cpi_debt_maturity ON public.closing_pipeline_items (debt_maturity_date);
