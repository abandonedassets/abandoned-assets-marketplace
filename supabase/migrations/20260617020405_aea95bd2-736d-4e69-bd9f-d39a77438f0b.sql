-- Explicit admin-only INSERT/UPDATE/DELETE policies on escrow-docs bucket
CREATE POLICY "Admins can upload escrow docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'escrow-docs' AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update escrow docs"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'escrow-docs' AND public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (bucket_id = 'escrow-docs' AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete escrow docs"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'escrow-docs' AND public.has_role(auth.uid(), 'admin'::public.app_role));