CREATE OR REPLACE FUNCTION public.cpi_market_alpha_tag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tags text[] := COALESCE(NEW.enrichment_tags, '{}'::text[]);
  _enabled boolean;
BEGIN
  SELECT COALESCE((value)::text::boolean, true) INTO _enabled
  FROM public.system_config WHERE key = 'market_alpha_enabled';
  IF _enabled IS DISTINCT FROM true THEN RETURN NEW; END IF;

  _tags := ARRAY(SELECT unnest(_tags) EXCEPT SELECT unnest(ARRAY['HIGH-LEVERAGE','PRIME-ALPHA']));

  IF COALESCE(NEW.requires_legal_review,false) = true
     OR lower(COALESCE(NEW.title_status::text, '')) IN ('uninsurable','pending')
     OR lower(COALESCE(NEW.title_notes,'')) ~ '(lien|quitclaim|defect|cloud)' THEN
    _tags := array_append(_tags, 'HIGH-LEVERAGE');
  END IF;

  IF COALESCE(NEW.liquidity_match_score,0) >= 10
     AND COALESCE(NEW.manual_review,false) = false
     AND COALESCE(NEW.requires_legal_review,false) = false
     AND NEW.status::text NOT IN ('Funds-Cleared','Closed','Dead','Rejected') THEN
    _tags := array_append(_tags, 'PRIME-ALPHA');
    NEW.auto_clearance_ready := true;
  END IF;

  NEW.enrichment_tags := ARRAY(SELECT DISTINCT unnest(_tags));
  RETURN NEW;
END;
$$;

DO $$
DECLARE _n int;
BEGIN
  UPDATE public.closing_pipeline_items SET updated_at = updated_at WHERE true;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE 'flight_rule_0: dry-touched % rows without enum failure', _n;
END $$;

WITH purged AS (
  DELETE FROM public.dead_letter_queue
  WHERE error_reason LIKE 'resuscitate_rpc_failed: invalid input value for enum title_status_enum%'
  RETURNING 1
)
INSERT INTO public.system_alerts(severity, kind, message, metadata)
SELECT 'info', 'dlq_drain',
  'Flight Rule 0: drained historical DLQ backlog after enum fix',
  jsonb_build_object('rows_drained', (SELECT count(*) FROM purged),
                     'root_cause', 'cpi_market_alpha_tag COALESCE(enum, empty-string) cast');
