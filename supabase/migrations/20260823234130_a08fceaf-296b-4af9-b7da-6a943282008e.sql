
ALTER TABLE public.retail_locations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'New',
  ADD COLUMN IF NOT EXISTS base_annual_cost numeric,
  ADD COLUMN IF NOT EXISTS projected_10yr_cost numeric,
  ADD COLUMN IF NOT EXISTS evaluated_at timestamptz,
  ADD COLUMN IF NOT EXISTS evaluation_note text;

CREATE INDEX IF NOT EXISTS idx_retail_locations_status ON public.retail_locations(status);

CREATE OR REPLACE FUNCTION public.retail_location_coords(_id uuid)
RETURNS TABLE(lon double precision, lat double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ST_X(geom::geometry), ST_Y(geom::geometry)
  FROM public.retail_locations WHERE id = _id
$$;

CREATE OR REPLACE FUNCTION public.retail_supplier_proximity_count(_id uuid, _radius_miles double precision DEFAULT 1)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.retail_locations s, public.retail_locations t
  WHERE t.id = _id
    AND s.id <> t.id
    AND s.is_active
    AND s.kind = 'substation'
    AND ST_DWithin(s.geom::geography, t.geom::geography, _radius_miles * 1609.344)
$$;

GRANT EXECUTE ON FUNCTION public.retail_location_coords(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retail_supplier_proximity_count(uuid, double precision) TO authenticated, service_role;
