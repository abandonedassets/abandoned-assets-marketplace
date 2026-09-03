
DROP POLICY IF EXISTS "Authenticated can read status history" ON public.pipeline_status_history;

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can receive own pipeline broadcasts" ON realtime.messages;
CREATE POLICY "Authenticated users can receive own pipeline broadcasts"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.closing_pipeline_items c
    WHERE c.user_id = auth.uid()
  )
);
