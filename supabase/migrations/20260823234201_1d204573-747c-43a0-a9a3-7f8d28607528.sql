
REVOKE ALL ON FUNCTION public.retail_location_coords(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retail_supplier_proximity_count(uuid, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retail_location_coords(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.retail_supplier_proximity_count(uuid, double precision) TO service_role;
