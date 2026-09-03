CREATE TABLE public.payout_recipient_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  bank_name text,
  routing_number text,
  account_number text,
  account_type text NOT NULL DEFAULT 'checking',
  allocation_pct numeric NOT NULL DEFAULT 0,
  flat_amount_usd numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.payout_recipient_profiles TO service_role;

ALTER TABLE public.payout_recipient_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only" ON public.payout_recipient_profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_prp_updated_at
  BEFORE UPDATE ON public.payout_recipient_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.internal_beneficiary_allocations
  ADD COLUMN IF NOT EXISTS recipient_profile_id uuid REFERENCES public.payout_recipient_profiles(id),
  ADD COLUMN IF NOT EXISTS dispatch_rail text;

INSERT INTO public.payout_recipient_profiles (recipient_key, display_name, allocation_pct, is_active)
VALUES
  ('JACQUITA', 'Jacquita — Designated Destination Account', 0, true),
  ('DAUGHTER', 'Daughter — Designated Destination Account', 0, true)
ON CONFLICT (recipient_key) DO NOTHING;