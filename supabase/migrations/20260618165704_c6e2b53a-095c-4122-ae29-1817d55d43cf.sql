DROP POLICY IF EXISTS pipeline_owners_topic_scoped ON realtime.messages;

CREATE POLICY pipeline_owners_topic_scoped
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.closing_pipeline_items c
    WHERE realtime.topic() = 'pipeline:' || c.id::text
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  )
);