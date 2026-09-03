
DROP POLICY IF EXISTS "pipeline_owners_topic_insert" ON realtime.messages;

CREATE POLICY "pipeline_owners_topic_insert"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  (realtime.topic() LIKE 'pipeline:%')
  AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.closing_pipeline_items cpi
      WHERE cpi.id::text = split_part(realtime.topic(), ':', 2)
        AND cpi.user_id = auth.uid()
    )
  )
);
