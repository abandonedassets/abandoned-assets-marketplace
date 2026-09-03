
-- 1. Immutable status history (audit trail)
CREATE TABLE IF NOT EXISTS public.pipeline_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid NOT NULL REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  old_escrow_status text,
  new_escrow_status text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pipeline_status_history TO authenticated;
GRANT ALL ON public.pipeline_status_history TO service_role;

ALTER TABLE public.pipeline_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read status history"
  ON public.pipeline_status_history FOR SELECT
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_psh_item ON public.pipeline_status_history(pipeline_item_id, changed_at DESC);

-- 2. Trigger: append-only log of every status / escrow_status change
CREATE OR REPLACE FUNCTION public.log_pipeline_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.pipeline_status_history(pipeline_item_id, old_status, new_status, old_escrow_status, new_escrow_status)
    VALUES (NEW.id, NULL, NEW.status::text, NULL, NEW.escrow_status);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.escrow_status IS DISTINCT FROM OLD.escrow_status THEN
    INSERT INTO public.pipeline_status_history(pipeline_item_id, old_status, new_status, old_escrow_status, new_escrow_status)
    VALUES (NEW.id, OLD.status::text, NEW.status::text, OLD.escrow_status, NEW.escrow_status);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_pipeline_status_change ON public.closing_pipeline_items;
CREATE TRIGGER trg_log_pipeline_status_change
AFTER INSERT OR UPDATE OF status, escrow_status ON public.closing_pipeline_items
FOR EACH ROW EXECUTE FUNCTION public.log_pipeline_status_change();

-- 3. Intelligence view: days-in-status + risk flag computed in the database
CREATE OR REPLACE VIEW public.view_pipeline_health
WITH (security_invoker = true)
AS
WITH last_change AS (
  SELECT pipeline_item_id, MAX(changed_at) AS last_status_change_at
  FROM public.pipeline_status_history
  GROUP BY pipeline_item_id
)
SELECT
  c.id,
  c.zip,
  c.address,
  c.status::text                                  AS status,
  c.escrow_status,
  c.base_contract_price,
  c.optimized_acquisition_premium,
  c.cleared_at,
  c.cleared_amount,
  c.locked_at,
  c.updated_at,
  COALESCE(lc.last_status_change_at, c.updated_at) AS status_since,
  GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(lc.last_status_change_at, c.updated_at))) / 86400)::int
    AS days_in_current_status,
  CASE
    WHEN c.status::text IN ('Funds-Cleared','Closed','Dead') THEN 'OK'
    WHEN GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(lc.last_status_change_at, c.updated_at))) / 86400) > 14
      THEN 'HIGH_RISK'
    WHEN GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(lc.last_status_change_at, c.updated_at))) / 86400) > 7
      THEN 'WATCH'
    ELSE 'OK'
  END AS risk_flag
FROM public.closing_pipeline_items c
LEFT JOIN last_change lc ON lc.pipeline_item_id = c.id;

GRANT SELECT ON public.view_pipeline_health TO authenticated, service_role;

-- 4. Backfill: seed history with a baseline row for every existing item
INSERT INTO public.pipeline_status_history (pipeline_item_id, old_status, new_status, old_escrow_status, new_escrow_status, changed_at)
SELECT c.id, NULL, c.status::text, NULL, c.escrow_status, c.updated_at
FROM public.closing_pipeline_items c
WHERE NOT EXISTS (
  SELECT 1 FROM public.pipeline_status_history h WHERE h.pipeline_item_id = c.id
);
