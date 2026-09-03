ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS lock_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cpi_lock_expires_at
  ON public.closing_pipeline_items (lock_expires_at)
  WHERE lock_expires_at IS NOT NULL;

ALTER TABLE public.offer_delivery_logs
  ADD COLUMN IF NOT EXISTS pipeline_item_id uuid
  REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_odl_pipeline_item_id
  ON public.offer_delivery_logs (pipeline_item_id);