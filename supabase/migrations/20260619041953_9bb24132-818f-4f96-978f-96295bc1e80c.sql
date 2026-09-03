-- 1. Fix Realtime topic policy bypass: restrict to system_metrics topics only
DROP POLICY IF EXISTS system_metrics_topic_admin_only ON realtime.messages;
DROP POLICY IF EXISTS system_metrics_topic_admin_only_insert ON realtime.messages;

CREATE POLICY system_metrics_topic_admin_only
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.topic() LIKE '%system_metrics%'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY system_metrics_topic_admin_only_insert
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    realtime.topic() LIKE '%system_metrics%'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- 2. Document service_role intent on reverse_strike_queue
CREATE POLICY "Service role manages reverse strike queue"
  ON public.reverse_strike_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. Document service_role intent on routing_endpoints
CREATE POLICY "Service role manages routing endpoints"
  ON public.routing_endpoints
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Backfill + enforce NOT NULL on shadow_escrow_ledger.user_id
UPDATE public.shadow_escrow_ledger sel
   SET user_id = cpi.user_id
  FROM public.closing_pipeline_items cpi
 WHERE sel.pipeline_item_id = cpi.id
   AND sel.user_id IS NULL
   AND cpi.user_id IS NOT NULL;

DELETE FROM public.shadow_escrow_ledger WHERE user_id IS NULL;

ALTER TABLE public.shadow_escrow_ledger
  ALTER COLUMN user_id SET NOT NULL;