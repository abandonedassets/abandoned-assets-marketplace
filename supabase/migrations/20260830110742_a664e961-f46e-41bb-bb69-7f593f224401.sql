CREATE OR REPLACE FUNCTION public.record_buyer_event(_email text, _event text)
RETURNS public.buyer_scorecards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.buyer_scorecards; rate numeric; score numeric;
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

  rate := CASE WHEN r.deals_claimed > 0 THEN r.deals_funded::numeric / r.deals_claimed ELSE NULL END;
  score := GREATEST(0, LEAST(100,
      100 - (r.emd_timeouts * 35) - (r.pof_failures * 15) + LEAST(20, r.deals_funded * 10)
      - CASE WHEN rate IS NOT NULL AND r.deals_claimed >= 3 THEN ROUND((1 - rate) * 40) ELSE 0 END));

  UPDATE public.buyer_scorecards SET
    reliability_score = score,
    tier = CASE
      WHEN r.emd_timeouts >= 3 THEN 'purged'
      WHEN score < 40 THEN 'purged'
      WHEN r.deals_claimed >= 3 AND rate < 0.4 THEN 'delayed'
      WHEN r.deals_funded >= 1 AND r.emd_timeouts = 0 AND r.pof_failures = 0 THEN 'priority'
      ELSE 'standard'
    END
  WHERE id = r.id
  RETURNING * INTO r;

  RETURN r;
END;
$$;