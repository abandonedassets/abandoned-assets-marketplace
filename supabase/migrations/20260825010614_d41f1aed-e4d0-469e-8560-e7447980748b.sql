ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS closing_bundle_url text,
  ADD COLUMN IF NOT EXISTS closing_bundle_path text,
  ADD COLUMN IF NOT EXISTS closing_bundle_hash text,
  ADD COLUMN IF NOT EXISTS closing_bundle_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS title_commitment_url text,
  ADD COLUMN IF NOT EXISTS lien_search_result jsonb;

DROP POLICY IF EXISTS "closing packages admin read" ON storage.objects;
CREATE POLICY "closing packages admin read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'closing-packages' AND public.has_role(auth.uid(), 'admin'));