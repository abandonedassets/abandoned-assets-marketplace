
-- 1) buyer_waitlist: validate public submissions server-side
CREATE OR REPLACE FUNCTION public.bw_sanitize_public_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IN ('anon','authenticated') AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
    IF NEW.contact_email IS NULL OR NEW.contact_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(NEW.contact_email) > 254 THEN
      RAISE EXCEPTION 'invalid contact_email';
    END IF;
    NEW.fund_name := left(coalesce(NEW.fund_name,''), 200);
    NEW.message := left(coalesce(NEW.message,''), 2000);
    NEW.contact_phone := left(coalesce(NEW.contact_phone,''), 32);
    NEW.aum_bracket := left(coalesce(NEW.aum_bracket,''), 64);
    -- untrusted parties cannot set internal scoring/state fields
    NEW.status := 'pending';
    NEW.buyer_tier := NULL;
    NEW.deal_value := NULL;
    NEW.target_fee := NULL;
    NEW.impact_days := NULL;
    NEW.lien_status_verified := false;
    NEW.estoppel_bundle := NULL;
    NEW.is_stale := false;
    IF NEW.target_zips IS NOT NULL AND array_length(NEW.target_zips, 1) > 50 THEN
      RAISE EXCEPTION 'too many target_zips';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bw_sanitize_public_insert ON public.buyer_waitlist;
CREATE TRIGGER trg_bw_sanitize_public_insert
BEFORE INSERT ON public.buyer_waitlist
FOR EACH ROW EXECUTE FUNCTION public.bw_sanitize_public_insert();

-- 2) conversion_events: untrusted inserts cannot set financial/state fields
CREATE OR REPLACE FUNCTION public.ce_sanitize_public_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IN ('anon','authenticated') AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
    IF NEW.pipeline_item_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.closing_pipeline_items c WHERE c.id = NEW.pipeline_item_id) THEN
      RAISE EXCEPTION 'invalid pipeline_item_id';
    END IF;
    IF NEW.event IS NULL OR length(NEW.event) > 64 THEN
      RAISE EXCEPTION 'invalid event';
    END IF;
    IF NEW.buyer_email IS NOT NULL AND (length(NEW.buyer_email) > 254 OR NEW.buyer_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
      RAISE EXCEPTION 'invalid buyer_email';
    END IF;
    NEW.channel := left(coalesce(NEW.channel,'web'), 32);
    NEW.user_agent := left(coalesce(NEW.user_agent,''), 512);
    NEW.referer := left(coalesce(NEW.referer,''), 512);
    -- financial/state fields are server-owned only
    NEW.fee_amount := NULL;
    NEW.status := 'pending';
    NEW.impact_days := NULL;
    NEW.lien_status_verified := false;
    NEW.payout_cleared_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_sanitize_public_insert ON public.conversion_events;
CREATE TRIGGER trg_ce_sanitize_public_insert
BEFORE INSERT ON public.conversion_events
FOR EACH ROW EXECUTE FUNCTION public.ce_sanitize_public_insert();

-- 3) shadow_liquidity_queue: validate webhook URLs, protect capital allocation
CREATE OR REPLACE FUNCTION public.slq_validate_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  host text;
BEGIN
  IF auth.role() = 'authenticated' AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
    IF NEW.webhook_target_url IS NOT NULL AND NEW.webhook_target_url <> '' THEN
      IF NEW.webhook_target_url !~* '^https://' OR length(NEW.webhook_target_url) > 2048 THEN
        RAISE EXCEPTION 'webhook_target_url must be a https URL';
      END IF;
      host := lower(split_part(split_part(regexp_replace(NEW.webhook_target_url, '^https://', '', 'i'), '/', 1), ':', 1));
      IF host = '' OR host ~ '^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[)'
         OR host LIKE '%.local' OR host LIKE '%.internal' OR host = 'metadata.google.internal' THEN
        RAISE EXCEPTION 'webhook_target_url may not target internal networks';
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.allocated_capital_usd IS DISTINCT FROM OLD.allocated_capital_usd THEN
      NEW.allocated_capital_usd := OLD.allocated_capital_usd;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_slq_validate_webhook ON public.shadow_liquidity_queue;
CREATE TRIGGER trg_slq_validate_webhook
BEFORE INSERT OR UPDATE ON public.shadow_liquidity_queue
FOR EACH ROW EXECUTE FUNCTION public.slq_validate_webhook();
