
-- 1. Bundles table
CREATE TABLE public.bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  region_tag TEXT,
  total_base NUMERIC NOT NULL DEFAULT 0,
  total_fee NUMERIC NOT NULL DEFAULT 0,
  total_arv NUMERIC NOT NULL DEFAULT 0,
  deal_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  reserved_for_fund TEXT,
  soft_lock_until TIMESTAMPTZ,
  criteria JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bundles TO authenticated;
GRANT ALL ON public.bundles TO service_role;

ALTER TABLE public.bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read bundles"
  ON public.bundles FOR SELECT TO authenticated USING (true);

CREATE TRIGGER bundles_updated_at
  BEFORE UPDATE ON public.bundles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Link deals to bundles + hold flags
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN bundle_id UUID REFERENCES public.bundles(id) ON DELETE SET NULL,
  ADD COLUMN is_held BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN held_until TIMESTAMPTZ;

CREATE INDEX idx_pipeline_bundle ON public.closing_pipeline_items(bundle_id);

-- 3. Recalc fn — totals from current member deals
CREATE OR REPLACE FUNCTION public.recalc_bundle_totals(_bundle_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _bundle_id IS NULL THEN RETURN; END IF;
  UPDATE public.bundles b SET
    total_base = COALESCE((SELECT SUM(base_contract_price) FROM public.closing_pipeline_items
                           WHERE bundle_id = _bundle_id AND is_held = false), 0),
    total_fee  = COALESCE((SELECT SUM(optimized_acquisition_premium) FROM public.closing_pipeline_items
                           WHERE bundle_id = _bundle_id AND is_held = false), 0),
    total_arv  = COALESCE((SELECT SUM(base_contract_price + COALESCE(optimized_acquisition_premium,0))
                           FROM public.closing_pipeline_items
                           WHERE bundle_id = _bundle_id AND is_held = false), 0),
    deal_count = COALESCE((SELECT COUNT(*) FROM public.closing_pipeline_items
                           WHERE bundle_id = _bundle_id AND is_held = false), 0),
    updated_at = now()
  WHERE id = _bundle_id;
END;
$$;

-- 4. Trigger fn — auto-detach held/closed deals, recalc affected bundles
CREATE OR REPLACE FUNCTION public.sync_bundle_on_deal_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  closed_statuses TEXT[] := ARRAY['Closed','Dead','CRITICAL_STALL'];
BEGIN
  -- Auto-detach if held or in terminal status
  IF TG_OP IN ('INSERT','UPDATE') THEN
    IF (NEW.is_held = true OR NEW.status::text = ANY(closed_statuses)) AND NEW.bundle_id IS NOT NULL THEN
      NEW.bundle_id := NULL;
    END IF;
  END IF;

  -- Recalc old bundle (if changed/removed)
  IF TG_OP = 'UPDATE' AND OLD.bundle_id IS DISTINCT FROM NEW.bundle_id AND OLD.bundle_id IS NOT NULL THEN
    PERFORM public.recalc_bundle_totals(OLD.bundle_id);
  END IF;
  IF TG_OP = 'DELETE' AND OLD.bundle_id IS NOT NULL THEN
    PERFORM public.recalc_bundle_totals(OLD.bundle_id);
    RETURN OLD;
  END IF;

  -- Recalc new/current bundle
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.bundle_id IS NOT NULL THEN
    PERFORM public.recalc_bundle_totals(NEW.bundle_id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_bundle_biud
  BEFORE INSERT OR UPDATE OF bundle_id, is_held, status, base_contract_price, optimized_acquisition_premium
  ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_bundle_on_deal_change();

CREATE TRIGGER trg_sync_bundle_adel
  AFTER DELETE ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_bundle_on_deal_change();
