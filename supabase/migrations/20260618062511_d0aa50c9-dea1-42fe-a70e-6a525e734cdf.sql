DROP POLICY IF EXISTS "Authenticated users can receive broadcasts" ON realtime.messages;
DROP POLICY IF EXISTS "pipeline_owners_can_subscribe" ON realtime.messages;
DROP POLICY IF EXISTS "pipeline_owners_topic_scoped" ON realtime.messages;

CREATE POLICY "pipeline_owners_topic_scoped"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.closing_pipeline_items c
    WHERE c.user_id = auth.uid()
      AND realtime.topic() LIKE '%' || c.id::text || '%'
  )
);
