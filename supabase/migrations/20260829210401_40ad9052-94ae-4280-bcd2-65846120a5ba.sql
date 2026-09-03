CREATE INDEX IF NOT EXISTS idx_cpi_open_pipeline
  ON public.closing_pipeline_items (status, zip)
  WHERE cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cpi_open_premium
  ON public.closing_pipeline_items (optimized_acquisition_premium DESC)
  WHERE cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bbb_active
  ON public.buyer_buy_boxes (active)
  WHERE active = true;

CREATE OR REPLACE FUNCTION public.trg_instant_deal_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.cleared_at IS NULL
     AND NEW.status::text IN ('Shadow_Matched','Pending-Underwriting','House-Bid')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    BEGIN
      PERFORM net.http_post(
        url := 'https://project--dd9b0412-ab83-4f6e-86a4-cd1dedd921cc.lovable.app/api/public/hooks/m2m-cycle',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('asset_id', NEW.id)
      );
    EXCEPTION WHEN OTHERS THEN
      NULL; -- fail-forward: never stall the row
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_asset_strike_ready ON public.closing_pipeline_items;
CREATE TRIGGER on_asset_strike_ready
  AFTER INSERT OR UPDATE OF status ON public.closing_pipeline_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_instant_deal_match();