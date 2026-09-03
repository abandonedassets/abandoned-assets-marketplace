
-- Columns
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS absolute_floor_price numeric,
  ADD COLUMN IF NOT EXISTS seller_routing_json jsonb;

-- Queue
CREATE TABLE IF NOT EXISTS public.reverse_strike_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid NOT NULL REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  zip text,
  original_price numeric,
  floor_price numeric,
  counter_offer numeric,
  seller_routing_json jsonb,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | dispatched | failed | abandoned
  dispatch_attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_response jsonb,
  last_error text,
  dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.reverse_strike_queue TO authenticated;
GRANT ALL ON public.reverse_strike_queue TO service_role;

ALTER TABLE public.reverse_strike_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rsq_admin_all" ON public.reverse_strike_queue
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_rsq_pending
  ON public.reverse_strike_queue(created_at)
  WHERE status = 'pending';

CREATE TRIGGER trg_rsq_updated_at
  BEFORE UPDATE ON public.reverse_strike_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Default counter-offer percentage (0.92 = 92% of floor)
INSERT INTO public.system_config(key, value)
VALUES ('reverse_strike_counter_pct', '0.92'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Trigger: fire on bid decay below absolute floor
CREATE OR REPLACE FUNCTION public.cpi_fire_reverse_strike()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _pct numeric;
  _counter numeric;
  _existing integer;
BEGIN
  IF NEW.absolute_floor_price IS NULL OR NEW.base_contract_price IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.base_contract_price >= NEW.absolute_floor_price THEN
    RETURN NEW;
  END IF;
  IF NEW.status::text IN ('Funds-Cleared','Closed','Dead','CRITICAL_STALL','Locked-Escrow-Pending') THEN
    RETURN NEW;
  END IF;

  -- Dedup: skip if pending or dispatched within last 24h for this asset
  SELECT COUNT(*) INTO _existing
  FROM public.reverse_strike_queue
  WHERE pipeline_item_id = NEW.id
    AND (status = 'pending'
         OR (status = 'dispatched' AND dispatched_at > now() - interval '24 hours'));
  IF _existing > 0 THEN RETURN NEW; END IF;

  SELECT COALESCE((value)::text::numeric, 0.92) INTO _pct
  FROM public.system_config WHERE key = 'reverse_strike_counter_pct';
  IF _pct IS NULL OR _pct <= 0 OR _pct >= 1 THEN _pct := 0.92; END IF;

  _counter := ROUND(NEW.absolute_floor_price * _pct);

  INSERT INTO public.reverse_strike_queue(
    pipeline_item_id, zip, original_price, floor_price, counter_offer,
    seller_routing_json, payload
  ) VALUES (
    NEW.id, NEW.zip, NEW.base_contract_price, NEW.absolute_floor_price, _counter,
    NEW.seller_routing_json,
    jsonb_build_object(
      'event', 'reverse_strike',
      'asset_id', NEW.id,
      'zip', NEW.zip,
      'address', NEW.address,
      'apn', NEW.apn,
      'rejected_bid', NEW.base_contract_price,
      'floor_price', NEW.absolute_floor_price,
      'counter_offer', _counter,
      'counter_pct_of_floor', _pct,
      'reason', 'BID_BELOW_ABSOLUTE_FLOOR',
      'generated_at', now(),
      'seller_routing', NEW.seller_routing_json
    )
  );

  INSERT INTO public.system_alerts(severity, kind, message, deal_id, metadata)
  VALUES ('medium','reverse_strike_queued',
    'Reverse Strike queued: bid decayed below floor — counter-offer generated',
    NEW.id,
    jsonb_build_object('floor', NEW.absolute_floor_price, 'counter', _counter, 'zip', NEW.zip));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_reverse_strike ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_reverse_strike
  AFTER INSERT OR UPDATE OF base_contract_price, absolute_floor_price
  ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_fire_reverse_strike();
