
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS escrow_doc_path text;

-- Lock escrow-docs bucket to service-role only (no anon/authenticated access).
CREATE POLICY "escrow_docs_service_role_all"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'escrow-docs')
WITH CHECK (bucket_id = 'escrow-docs');
