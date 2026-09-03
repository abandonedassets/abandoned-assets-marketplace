DROP POLICY IF EXISTS "Authenticated users can view dead letter queue" ON public.dead_letter_queue;
CREATE POLICY "Admins can view dead letter queue"
ON public.dead_letter_queue FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));