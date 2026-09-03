
-- 1. Block owner DELETE on closing_pipeline_items except terminal/draft, restrict to service_role
DROP POLICY IF EXISTS "Owners can delete their pipeline items" ON public.closing_pipeline_items;

CREATE POLICY "Service role manages pipeline deletes"
  ON public.closing_pipeline_items FOR DELETE
  TO service_role
  USING (true);

-- Safety trigger: even if some future policy allows DELETE, block mid-deal rows
CREATE OR REPLACE FUNCTION public.cpi_block_active_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR session_user IN ('service_role','postgres') THEN
    RETURN OLD;
  END IF;
  IF OLD.status::text NOT IN ('Dead','Rejected','Scout') THEN
    RAISE EXCEPTION 'CANNOT_DELETE_ACTIVE_PIPELINE_ITEM: status=%', OLD.status
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpi_block_active_delete ON public.closing_pipeline_items;
CREATE TRIGGER trg_cpi_block_active_delete
  BEFORE DELETE ON public.closing_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.cpi_block_active_delete();

-- 2. bundles: add service_role write policies
CREATE POLICY "Service role manages bundles"
  ON public.bundles FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 3. realtime.messages: restrict INSERT on system_metrics topics to admins
CREATE POLICY "system_metrics_topic_admin_only_insert"
  ON realtime.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    (realtime.topic() NOT LIKE 'system_metrics%')
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );
