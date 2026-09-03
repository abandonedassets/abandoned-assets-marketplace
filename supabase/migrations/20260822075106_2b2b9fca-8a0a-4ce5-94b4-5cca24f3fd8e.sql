CREATE TABLE IF NOT EXISTS public.dispatch_dedupe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  buyer_id uuid,
  recipient_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dispatch_dedupe TO authenticated;
GRANT ALL ON public.dispatch_dedupe TO service_role;

ALTER TABLE public.dispatch_dedupe ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read dispatch dedupe" ON public.dispatch_dedupe;
CREATE POLICY "admins read dispatch dedupe" ON public.dispatch_dedupe
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_dedupe_property_buyer_uidx
  ON public.dispatch_dedupe (property_id, coalesce(buyer_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_dedupe_property_email_uidx
  ON public.dispatch_dedupe (property_id, lower(recipient_email));
CREATE INDEX IF NOT EXISTS dispatch_dedupe_email_time_idx
  ON public.dispatch_dedupe (lower(recipient_email), created_at DESC);

-- Claim a dispatch slot: enforces (property,buyer) uniqueness, 24h buyer
-- cooldown and a 25/hour global send cap. Returns allowed + reason.
CREATE OR REPLACE FUNCTION public.claim_dispatch_slot(
  _property_id uuid,
  _buyer_id uuid,
  _recipient_email text,
  _hourly_cap integer DEFAULT 25,
  _cooldown_hours integer DEFAULT 24
) RETURNS TABLE(allowed boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text := lower(trim(_recipient_email));
  _sent_last_hour integer;
  _last_to_buyer timestamptz;
BEGIN
  IF _email IS NULL OR _email = '' THEN
    RETURN QUERY SELECT false, 'no_recipient'; RETURN;
  END IF;

  SELECT count(*) INTO _sent_last_hour
  FROM public.dispatch_dedupe WHERE created_at > now() - interval '1 hour';
  IF _sent_last_hour >= _hourly_cap THEN
    RETURN QUERY SELECT false, 'hourly_cap'; RETURN;
  END IF;

  SELECT max(created_at) INTO _last_to_buyer
  FROM public.dispatch_dedupe WHERE lower(recipient_email) = _email;
  IF _last_to_buyer IS NOT NULL
     AND _last_to_buyer > now() - make_interval(hours => _cooldown_hours) THEN
    RETURN QUERY SELECT false, 'cooldown'; RETURN;
  END IF;

  BEGIN
    INSERT INTO public.dispatch_dedupe (property_id, buyer_id, recipient_email)
    VALUES (_property_id, _buyer_id, _email);
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, 'duplicate'; RETURN;
  END;

  RETURN QUERY SELECT true, 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_dispatch_slot(uuid, uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_dispatch_slot(uuid, uuid, text, integer, integer) TO service_role;