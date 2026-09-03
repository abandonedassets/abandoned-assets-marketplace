ALTER TABLE public.system_audit_logs
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS llm_confidence_score numeric,
  ADD COLUMN IF NOT EXISTS ip_address text;

CREATE INDEX IF NOT EXISTS idx_system_audit_logs_event_type ON public.system_audit_logs(event_type);

CREATE OR REPLACE FUNCTION public.sal_block_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'system_audit_logs is immutable';
END; $$;

DROP TRIGGER IF EXISTS trg_sal_immutable ON public.system_audit_logs;
CREATE TRIGGER trg_sal_immutable BEFORE UPDATE OR DELETE ON public.system_audit_logs
FOR EACH ROW EXECUTE FUNCTION public.sal_block_mutation();

CREATE TABLE IF NOT EXISTS public.webhook_replay_guard (
  event_id text PRIMARY KEY,
  source text NOT NULL,
  seen_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT ALL ON public.webhook_replay_guard TO service_role;
ALTER TABLE public.webhook_replay_guard ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wrg_service ON public.webhook_replay_guard;
CREATE POLICY wrg_service ON public.webhook_replay_guard TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_wrg_seen_at ON public.webhook_replay_guard(seen_at);

CREATE OR REPLACE FUNCTION public.resuscitate_stagnant_deals(_max_rows integer DEFAULT 50)
RETURNS TABLE(deal_id uuid, old_fee numeric, new_fee numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; nf numeric;
BEGIN
  FOR r IN
    SELECT id, optimized_acquisition_premium AS fee, absolute_floor_price
    FROM public.closing_pipeline_items
    WHERE updated_at < now() - interval '14 days'
      AND cleared_at IS NULL
      AND matched_buyer_id IS NULL
      AND status NOT IN ('Closed','Dead','Rejected','Funds-Cleared','Auto_Archived_Bad_Data')
      AND COALESCE(optimized_acquisition_premium,0) > 0
    ORDER BY optimized_acquisition_premium DESC
    LIMIT _max_rows
  LOOP
    BEGIN
      nf := round(r.fee * 0.95, 2);
      UPDATE public.closing_pipeline_items
        SET optimized_acquisition_premium = nf,
            resuscitation_count = COALESCE(resuscitation_count,0) + 1,
            last_resuscitated_at = now(),
            updated_at = now()
      WHERE id = r.id;

      INSERT INTO public.system_audit_logs(pipeline_item_id, reason, event_type, payload)
      VALUES (r.id, 'DEAL_RESUSCITATED', 'DEAL_RESUSCITATED',
              jsonb_build_object('old_fee', r.fee, 'new_fee', nf, 'reduction_pct', 5));

      deal_id := r.id; old_fee := r.fee; new_fee := nf;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;
END; $$;

SELECT cron.unschedule('resuscitate-stagnant-deals')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'resuscitate-stagnant-deals');

SELECT cron.schedule('resuscitate-stagnant-deals', '0 */6 * * *',
  $$SELECT public.resuscitate_stagnant_deals(50); DELETE FROM public.webhook_replay_guard WHERE seen_at < now() - interval '24 hours';$$);