CREATE TABLE public.buyer_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_name text NOT NULL,
  contact_email text,
  target_zips text[] NOT NULL DEFAULT '{}',
  aum_bracket text,
  message text,
  status text NOT NULL DEFAULT 'pending',
  source_ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.buyer_waitlist TO authenticated;
GRANT ALL ON public.buyer_waitlist TO service_role;

ALTER TABLE public.buyer_waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage waitlist"
ON public.buyer_waitlist
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER buyer_waitlist_updated_at
BEFORE UPDATE ON public.buyer_waitlist
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX buyer_waitlist_created_at_idx ON public.buyer_waitlist(created_at DESC);
CREATE INDEX buyer_waitlist_status_idx ON public.buyer_waitlist(status);