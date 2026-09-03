CREATE TABLE IF NOT EXISTS public.system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_config TO authenticated;
GRANT ALL ON public.system_config TO service_role;

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read system_config" ON public.system_config
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "service_role manages system_config" ON public.system_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.system_config(key, value) VALUES
  ('ACTIVE_GIS_URL', to_jsonb('https://maps.mcohio.org/arcgis/rest/services/Auditor/Parcels/MapServer/0/query'::text)),
  ('GIS_FAILOVER_ENDPOINTS', '["https://www.mcrealestate.org/arcgis/rest/services/Parcels/MapServer/0/query","https://gis.hamiltoncountyauditor.org/arcgis/rest/services/Parcels/MapServer/0/query","https://maps.franklincountyauditor.com/arcgis/rest/services/Parcels/MapServer/0/query"]'::jsonb),
  ('GIS_PORTAL_DISCOVERY_URL', to_jsonb('https://maps.mcohio.org/'::text)),
  ('GIS_DEPRECATED_URLS', '[]'::jsonb)
ON CONFLICT (key) DO NOTHING;