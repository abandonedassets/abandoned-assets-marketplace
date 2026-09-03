
-- 1) Tighten closing_pipeline_items owner policy: forbid NULL user_id on writes
DROP POLICY IF EXISTS "Owners can manage their pipeline items" ON public.closing_pipeline_items;

CREATE POLICY "Owners can view their pipeline items"
ON public.closing_pipeline_items
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owners can insert their pipeline items"
ON public.closing_pipeline_items
FOR INSERT
TO authenticated
WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "Owners can update their pipeline items"
ON public.closing_pipeline_items
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "Owners can delete their pipeline items"
ON public.closing_pipeline_items
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- 2) Escrow docs storage policies: owners (via closing_pipeline_items.escrow_doc_path) and admins
DROP POLICY IF EXISTS "Owners can read their escrow docs" ON storage.objects;
DROP POLICY IF EXISTS "Admins can read all escrow docs" ON storage.objects;

CREATE POLICY "Owners can read their escrow docs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'escrow-docs'
  AND EXISTS (
    SELECT 1 FROM public.closing_pipeline_items c
    WHERE c.escrow_doc_path = storage.objects.name
      AND c.user_id = auth.uid()
  )
);

CREATE POLICY "Admins can read all escrow docs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'escrow-docs'
  AND public.has_role(auth.uid(), 'admin')
);
