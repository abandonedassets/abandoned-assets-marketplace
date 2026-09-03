CREATE TABLE public.buyer_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_email text NOT NULL UNIQUE,
  deals_claimed integer NOT NULL DEFAULT 0,
  deals_funded integer NOT NULL DEFAULT 0,
  emd_timeouts integer NOT NULL DEFAULT 0,
  pof_failures integer NOT NULL DEFAULT 0,
  reliability_score numeric NOT NULL DEFAULT 100,
  tier text NOT NULL DEFAULT 'standard',
  last_event text,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.buyer_scorecards TO authenticated;
GRANT ALL ON public.buyer_scorecards TO service_role;

ALTER TABLE public.buyer_scorecards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read buyer scorecards"
ON public.buyer_scorecards FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_buyer_scorecards_updated_at
BEFORE UPDATE ON public.buyer_scorecards
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.record_buyer_event(_email text, _event text)
RETURNS public.buyer_scorecards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.buyer_scorecards;
BEGIN
  IF _email IS NULL OR btrim(_email) = '' THEN RETURN NULL; END IF;

  INSERT INTO public.buyer_scorecards (buyer_email)
  VALUES (lower(btrim(_email)))
  ON CONFLICT (buyer_email) DO NOTHING;

  UPDATE public.buyer_scorecards SET
    deals_claimed = deals_claimed + CASE WHEN _event = 'claimed' THEN 1 ELSE 0 END,
    deals_funded  = deals_funded  + CASE WHEN _event = 'funded' THEN 1 ELSE 0 END,
    emd_timeouts  = emd_timeouts  + CASE WHEN _event = 'emd_timeout' THEN 1 ELSE 0 END,
    pof_failures  = pof_failures  + CASE WHEN _event = 'pof_failed' THEN 1 ELSE 0 END,
    last_event = _event,
    last_activity_at = now()
  WHERE buyer_email = lower(btrim(_email))
  RETURNING * INTO r;

  UPDATE public.buyer_scorecards SET
    reliability_score = GREATEST(0, LEAST(100,
      100 - (r.emd_timeouts * 35) - (r.pof_failures * 15) + LEAST(20, r.deals_funded * 10))),
    tier = CASE
      WHEN r.emd_timeouts >= 3 THEN 'purged'
      WHEN (100 - (r.emd_timeouts * 35) - (r.pof_failures * 15) + LEAST(20, r.deals_funded * 10)) < 50 THEN 'purged'
      WHEN r.deals_funded >= 1 AND r.emd_timeouts = 0 AND r.pof_failures = 0 THEN 'priority'
      ELSE 'standard'
    END
  WHERE id = r.id
  RETURNING * INTO r;

  RETURN r;
END;
$$;