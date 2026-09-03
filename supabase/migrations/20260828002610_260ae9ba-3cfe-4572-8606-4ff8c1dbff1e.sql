ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS target_allocation_lane text NOT NULL DEFAULT 'MAIN_VAULT_TRACK',
  ADD COLUMN IF NOT EXISTS asset_category text NOT NULL DEFAULT '1031_RAW_LAND';

CREATE INDEX IF NOT EXISTS idx_cpi_allocation_lane ON public.closing_pipeline_items (target_allocation_lane);
CREATE INDEX IF NOT EXISTS idx_cpi_asset_category ON public.closing_pipeline_items (asset_category);