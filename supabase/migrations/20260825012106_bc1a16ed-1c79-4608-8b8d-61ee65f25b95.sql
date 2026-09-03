-- 1. Retail locations: remove blanket authenticated read; admins only.
DROP POLICY IF EXISTS "Authenticated can view retail locations" ON public.retail_locations;

-- 2. PostGIS reference table: enable RLS with a read-only policy.
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "spatial_ref_sys read only" ON public.spatial_ref_sys';
    EXECUTE 'CREATE POLICY "spatial_ref_sys read only" ON public.spatial_ref_sys FOR SELECT TO anon, authenticated USING (true)';
  EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
    -- Extension-owned table: fall back to revoking Data API read access.
    EXECUTE 'REVOKE SELECT ON public.spatial_ref_sys FROM anon, authenticated';
  END;
END $$;