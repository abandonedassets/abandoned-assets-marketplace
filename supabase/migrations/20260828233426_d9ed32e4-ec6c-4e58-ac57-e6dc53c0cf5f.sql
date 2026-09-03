ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS allocation_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS tracking_session_timeout interval DEFAULT '00:30:00';

ALTER TABLE public.buyer_buy_boxes
  ADD COLUMN IF NOT EXISTS irs_identification_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS specialized_asset_focus text DEFAULT '1031_EQUIVALENT';

CREATE INDEX IF NOT EXISTS idx_cpi_allocation_expires_at
  ON public.closing_pipeline_items (allocation_expires_at)
  WHERE allocation_expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.auto_evict_stale_allocations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  evicted integer := 0;
BEGIN
  WITH e AS (
    UPDATE public.closing_pipeline_items
    SET reverse_strike_ready = true,
        matched_buyer_id = NULL,
        allocation_expires_at = NULL,
        wire_instructions_status = 'EVICTED',
        virtual_account_number = NULL,
        virtual_routing_number = NULL
    WHERE allocation_expires_at IS NOT NULL
      AND allocation_expires_at < now()
      AND cleared_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO evicted FROM e;
  RETURN evicted;
EXCEPTION WHEN OTHERS THEN
  RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_evict_stale_allocations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_evict_stale_allocations() TO service_role;