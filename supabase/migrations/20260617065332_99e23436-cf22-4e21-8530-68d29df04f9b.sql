
ALTER PUBLICATION supabase_realtime DROP TABLE public.closing_pipeline_items;
DROP POLICY IF EXISTS "Admins can view all pipeline items" ON public.closing_pipeline_items;
