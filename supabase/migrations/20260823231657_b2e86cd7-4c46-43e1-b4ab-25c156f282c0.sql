CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE public.retail_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'store',
  address text,
  city text,
  state text,
  zip text,
  geom geography(Point, 4326) NOT NULL,
  boundary jsonb,
  is_active boolean NOT NULL DEFAULT true,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX retail_locations_geom_idx ON public.retail_locations USING GIST (geom);
CREATE INDEX retail_locations_kind_idx ON public.retail_locations (kind);

GRANT SELECT ON public.retail_locations TO authenticated;
GRANT ALL ON public.retail_locations TO service_role;

ALTER TABLE public.retail_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view retail locations"
  ON public.retail_locations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage retail locations"
  ON public.retail_locations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.retail_update_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_retail_locations_updated_at
BEFORE UPDATE ON public.retail_locations
FOR EACH ROW EXECUTE FUNCTION public.retail_update_updated_at();

CREATE OR REPLACE FUNCTION public.retail_stores_within_radius(
  _lon double precision,
  _lat double precision,
  _radius_miles double precision DEFAULT 1
)
RETURNS TABLE (
  id uuid,
  name text,
  kind text,
  address text,
  city text,
  state text,
  zip text,
  lon double precision,
  lat double precision,
  distance_miles double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.name, r.kind, r.address, r.city, r.state, r.zip,
         ST_X(r.geom::geometry) AS lon,
         ST_Y(r.geom::geometry) AS lat,
         ST_Distance(r.geom, ST_MakePoint(_lon, _lat)::geography) / 1609.344 AS distance_miles
  FROM public.retail_locations r
  WHERE r.is_active
    AND r.kind = 'store'
    AND ST_DWithin(r.geom, ST_MakePoint(_lon, _lat)::geography, _radius_miles * 1609.344)
  ORDER BY 10;
$$;

REVOKE ALL ON FUNCTION public.retail_stores_within_radius(double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retail_stores_within_radius(double precision, double precision, double precision) TO authenticated, service_role;