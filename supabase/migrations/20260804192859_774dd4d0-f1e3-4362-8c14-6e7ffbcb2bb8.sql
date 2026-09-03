CREATE TABLE public.esign_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_item_id uuid NOT NULL REFERENCES public.closing_pipeline_items(id) ON DELETE CASCADE,
  buyer_email text NOT NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'Sent',
  assignment_fee numeric,
  signer_name text,
  signer_ip text,
  signed_at timestamptz,
  invoice_url text,
  invoice_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.esign_requests TO authenticated;
GRANT ALL ON public.esign_requests TO service_role;
ALTER TABLE public.esign_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "esign_admin_read" ON public.esign_requests FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER esign_requests_updated_at BEFORE UPDATE ON public.esign_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_esign_requests_item ON public.esign_requests(pipeline_item_id);

CREATE TABLE public.inbound_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_email text,
  subject text,
  body_preview text,
  detected_intent text,
  matched_item_id uuid,
  action_taken text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.inbound_email_log TO authenticated;
GRANT ALL ON public.inbound_email_log TO service_role;
ALTER TABLE public.inbound_email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inbound_email_admin_read" ON public.inbound_email_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER inbound_email_log_updated_at BEFORE UPDATE ON public.inbound_email_log FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();