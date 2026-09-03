DROP POLICY IF EXISTS "Authenticated users can read pipeline status history" ON public.pipeline_status_history;
DROP POLICY IF EXISTS "pipeline_status_history_select" ON public.pipeline_status_history;
DROP POLICY IF EXISTS "Allow read pipeline status history" ON public.pipeline_status_history;

CREATE POLICY "Owners and admins can read pipeline status history"
ON public.pipeline_status_history
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.closing_pipeline_items c
    WHERE c.id = pipeline_status_history.pipeline_item_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);