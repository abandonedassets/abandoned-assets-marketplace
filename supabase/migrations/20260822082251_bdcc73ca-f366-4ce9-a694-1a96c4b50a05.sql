
-- Rate limiting + stricter validation for public waitlist inserts
CREATE OR REPLACE FUNCTION public.bw_rate_limit_public_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_total int;
  recent_email int;
BEGIN
  IF auth.role() IN ('anon','authenticated') AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
    SELECT count(*) INTO recent_email
    FROM public.buyer_waitlist
    WHERE lower(contact_email) = lower(NEW.contact_email)
      AND created_at > now() - interval '1 hour';
    IF recent_email >= 3 THEN
      RAISE EXCEPTION 'duplicate submission: please try again later';
    END IF;

    SELECT count(*) INTO recent_total
    FROM public.buyer_waitlist
    WHERE created_at > now() - interval '1 minute';
    IF recent_total >= 30 THEN
      RAISE EXCEPTION 'submission rate limit exceeded';
    END IF;

    IF NEW.contact_phone IS NOT NULL AND NEW.contact_phone <> ''
       AND NEW.contact_phone !~ '^[0-9+()\-.\s]{7,32}$' THEN
      RAISE EXCEPTION 'invalid contact_phone';
    END IF;
    IF NEW.message ~* '(https?://|<script)' THEN
      RAISE EXCEPTION 'invalid message content';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_rate_limit_public_insert() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_bw_rate_limit_public_insert ON public.buyer_waitlist;
CREATE TRIGGER trg_bw_rate_limit_public_insert
BEFORE INSERT ON public.buyer_waitlist
FOR EACH ROW EXECUTE FUNCTION public.bw_rate_limit_public_insert();

-- Rate limiting for public conversion event inserts
CREATE OR REPLACE FUNCTION public.ce_rate_limit_public_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_total int;
  recent_item int;
BEGIN
  IF auth.role() IN ('anon','authenticated') AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
    SELECT count(*) INTO recent_item
    FROM public.conversion_events
    WHERE pipeline_item_id = NEW.pipeline_item_id
      AND created_at > now() - interval '1 minute';
    IF recent_item >= 20 THEN
      RAISE EXCEPTION 'event rate limit exceeded for asset';
    END IF;

    SELECT count(*) INTO recent_total
    FROM public.conversion_events
    WHERE created_at > now() - interval '1 minute';
    IF recent_total >= 200 THEN
      RAISE EXCEPTION 'global event rate limit exceeded';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ce_rate_limit_public_insert() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_ce_rate_limit_public_insert ON public.conversion_events;
CREATE TRIGGER trg_ce_rate_limit_public_insert
BEFORE INSERT ON public.conversion_events
FOR EACH ROW EXECUTE FUNCTION public.ce_rate_limit_public_insert();

-- Remove PII-bearing tables from the realtime publication (admin-only reads)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='buyer_waitlist') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.buyer_waitlist;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='conversion_events') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.conversion_events;
  END IF;
END $$;
