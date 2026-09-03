
DROP POLICY IF EXISTS system_metrics_topic_admin_only ON realtime.messages;
CREATE POLICY system_metrics_topic_admin_only
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (realtime.topic() LIKE '%system_metrics%' AND public.has_role(auth.uid(), 'admin'::public.app_role))
  OR realtime.topic() NOT LIKE '%system_metrics%'
);
