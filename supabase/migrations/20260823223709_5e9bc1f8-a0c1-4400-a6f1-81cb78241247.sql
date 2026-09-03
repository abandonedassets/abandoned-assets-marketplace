CREATE TABLE IF NOT EXISTS public.entity_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_name text NOT NULL,
  jurisdiction text,
  registry_id text,
  registered_agent text,
  principal_address text,
  mailing_address text,
  discovered_email text,
  discovered_phone text,
  discovery_tier text NOT NULL,
  source text NOT NULL,
  source_url text,
  mx_valid boolean NOT NULL DEFAULT false,
  mx_host text,
  verification_status text NOT NULL DEFAULT 'pending',
  verified_at timestamptz,
  asset_id uuid,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS entity_contacts_unique_email
  ON public.entity_contacts (lower(entity_name), lower(coalesce(discovered_email, '')));
CREATE INDEX IF NOT EXISTS entity_contacts_status_idx ON public.entity_contacts (verification_status);
CREATE INDEX IF NOT EXISTS entity_contacts_asset_idx ON public.entity_contacts (asset_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entity_contacts TO authenticated;
GRANT ALL ON public.entity_contacts TO service_role;

ALTER TABLE public.entity_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage entity_contacts" ON public.entity_contacts;
CREATE POLICY "Admins manage entity_contacts" ON public.entity_contacts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role manages entity_contacts" ON public.entity_contacts;
CREATE POLICY "Service role manages entity_contacts" ON public.entity_contacts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER entity_contacts_updated_at
  BEFORE UPDATE ON public.entity_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.buyer_waitlist
  ADD COLUMN IF NOT EXISTS contact_source text,
  ADD COLUMN IF NOT EXISTS contact_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS contact_mx_valid boolean NOT NULL DEFAULT false;