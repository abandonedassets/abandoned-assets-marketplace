ALTER TABLE public.esign_requests
  ADD COLUMN IF NOT EXISTS buyer_entity text,
  ADD COLUMN IF NOT EXISTS ofac_status text NOT NULL DEFAULT 'Unscreened',
  ADD COLUMN IF NOT EXISTS ofac_result jsonb,
  ADD COLUMN IF NOT EXISTS ofac_screened_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS signer_user_agent text,
  ADD COLUMN IF NOT EXISTS device_fingerprint text,
  ADD COLUMN IF NOT EXISTS nonrepudiation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS nonrepudiation_hash text;

CREATE TABLE IF NOT EXISTS public.title_cloud_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid NOT NULL REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  document_type text NOT NULL DEFAULT 'MEMORANDUM_OF_CONTRACT',
  document_text text NOT NULL,
  document_hash text NOT NULL,
  notary_status text NOT NULL DEFAULT 'Pending',
  notary_ref text,
  recording_status text NOT NULL DEFAULT 'Queued',
  recording_ref text,
  county text,
  apn text,
  recorded_at timestamptz,
  released_at timestamptz,
  last_error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS title_cloud_recordings_active_uq
  ON public.title_cloud_recordings (pipeline_item_id)
  WHERE released_at IS NULL;

GRANT SELECT ON public.title_cloud_recordings TO authenticated;
GRANT ALL ON public.title_cloud_recordings TO service_role;

ALTER TABLE public.title_cloud_recordings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read title cloud recordings" ON public.title_cloud_recordings;
CREATE POLICY "Admins read title cloud recordings"
  ON public.title_cloud_recordings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_tcr_updated_at ON public.title_cloud_recordings;
CREATE TRIGGER trg_tcr_updated_at BEFORE UPDATE ON public.title_cloud_recordings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();