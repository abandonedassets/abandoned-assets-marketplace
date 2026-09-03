
-- 1) Buyer buy-box matrix
CREATE TABLE public.buyer_buy_boxes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  buyer_id UUID NOT NULL,
  label TEXT,
  target_asset_types TEXT[] NOT NULL DEFAULT '{}',
  target_zip_codes TEXT[] NOT NULL DEFAULT '{}',
  max_contract_price NUMERIC NOT NULL,
  min_placement_margin NUMERIC NOT NULL DEFAULT 10000,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.buyer_buy_boxes TO authenticated;
GRANT ALL ON public.buyer_buy_boxes TO service_role;

ALTER TABLE public.buyer_buy_boxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their own buy-boxes"
  ON public.buyer_buy_boxes FOR ALL
  TO authenticated
  USING (auth.uid() = buyer_id)
  WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "Admins manage all buy-boxes"
  ON public.buyer_buy_boxes FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_buyer_buy_boxes_active ON public.buyer_buy_boxes(active) WHERE active = true;
CREATE INDEX idx_buyer_buy_boxes_zips ON public.buyer_buy_boxes USING GIN (target_zip_codes);
CREATE INDEX idx_buyer_buy_boxes_types ON public.buyer_buy_boxes USING GIN (target_asset_types);

CREATE TRIGGER update_buyer_buy_boxes_updated_at
  BEFORE UPDATE ON public.buyer_buy_boxes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Match tracking columns on deals
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS asset_type TEXT,
  ADD COLUMN IF NOT EXISTS matched_buyer_id UUID,
  ADD COLUMN IF NOT EXISTS matched_buy_box_id UUID;

CREATE INDEX IF NOT EXISTS idx_cpi_matched_buyer ON public.closing_pipeline_items(matched_buyer_id);

-- 3) Match handshake trigger
CREATE OR REPLACE FUNCTION public.match_orange_squares()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _bb RECORD;
  _eff_type TEXT;
BEGIN
  -- Skip if already cleared/closed
  IF NEW.status::text IN ('Funds-Cleared','Closed','Dead','CRITICAL_STALL') THEN
    RETURN NEW;
  END IF;

  -- Ensure auto_clearance_ready follows margin rule (preserves existing behavior)
  NEW.auto_clearance_ready := COALESCE(NEW.optimized_acquisition_premium, 0) >= 10000;

  -- Skip if already matched to a buyer (manual override safety)
  IF NEW.matched_buyer_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  _eff_type := COALESCE(NEW.asset_type, 'SFR');

  -- Find first qualifying buy-box (deterministic by created_at)
  SELECT id, buyer_id
    INTO _bb
  FROM public.buyer_buy_boxes
  WHERE active = true
    AND NEW.zip = ANY(target_zip_codes)
    AND _eff_type = ANY(target_asset_types)
    AND COALESCE(NEW.base_contract_price, 0) <= max_contract_price
    AND COALESCE(NEW.optimized_acquisition_premium, 0) >= min_placement_margin
  ORDER BY created_at ASC
  LIMIT 1;

  IF FOUND THEN
    NEW.matched_buyer_id := _bb.buyer_id;
    NEW.matched_buy_box_id := _bb.id;
    NEW.auto_clearance_ready := true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_orange_squares ON public.closing_pipeline_items;
DROP TRIGGER IF EXISTS trg_set_auto_clearance_ready ON public.closing_pipeline_items;

CREATE TRIGGER trg_match_orange_squares
  BEFORE INSERT OR UPDATE ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.match_orange_squares();
