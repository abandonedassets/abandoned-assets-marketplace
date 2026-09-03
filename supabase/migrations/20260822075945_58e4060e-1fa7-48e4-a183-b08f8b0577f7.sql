
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS reservation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS reservation_email text;

ALTER TABLE public.buyer_scorecards
  ADD COLUMN IF NOT EXISTS clicks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservation_expirations integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS velocity_score numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS last_click_at timestamptz;

CREATE OR REPLACE FUNCTION public.start_deal_reservation(_id uuid, _buyer_email text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.closing_pipeline_items;
  v_expires timestamptz;
  v_others integer := 0;
BEGIN
  SELECT * INTO r FROM public.closing_pipeline_items WHERE id = _id;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF r.tif_state = 'Executed' OR r.status IN ('WIRE_PENDING_VERIFICATION','SETTLED_PAID') THEN
    RETURN jsonb_build_object('ok', true, 'executed', true);
  END IF;

  IF r.reservation_expires_at IS NOT NULL AND r.reservation_expires_at > now()
     AND (_buyer_email IS NULL OR r.reservation_email IS NULL OR lower(r.reservation_email) = lower(_buyer_email)) THEN
    v_expires := r.reservation_expires_at;
  ELSIF r.reservation_expires_at IS NOT NULL AND r.reservation_expires_at > now() THEN
    RETURN jsonb_build_object('ok', true, 'locked_by_other', true,
      'expires_at', r.reservation_expires_at);
  ELSE
    v_expires := now() + interval '15 minutes';
    UPDATE public.closing_pipeline_items
       SET reservation_started_at = now(),
           reservation_expires_at = v_expires,
           reservation_email = COALESCE(_buyer_email, reservation_email)
     WHERE id = _id;
  END IF;

  -- scarcity telemetry: distinct viewers in the last 15 minutes
  BEGIN
    SELECT GREATEST(COUNT(DISTINCT COALESCE(ip_address::text, user_agent)) - 1, 0)
      INTO v_others
      FROM public.offer_delivery_logs
     WHERE contract_id = _id
       AND created_at > now() - interval '15 minutes';
  EXCEPTION WHEN OTHERS THEN v_others := 0;
  END;

  IF _buyer_email IS NOT NULL AND _buyer_email <> '' THEN
    BEGIN
      INSERT INTO public.buyer_scorecards (buyer_email, clicks, last_click_at, last_activity_at, last_event)
      VALUES (lower(_buyer_email), 1, now(), now(), 'RESERVATION_START')
      ON CONFLICT (buyer_email) DO UPDATE
        SET clicks = public.buyer_scorecards.clicks + 1,
            last_click_at = now(),
            last_activity_at = now(),
            last_event = 'RESERVATION_START';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'expires_at', v_expires, 'concurrent_viewers', v_others);
END;
$$;

CREATE OR REPLACE FUNCTION public.sweep_expired_reservations()
RETURNS TABLE(deal_id uuid, buyer_email text, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT id, reservation_email
      FROM public.closing_pipeline_items
     WHERE reservation_expires_at IS NOT NULL
       AND reservation_expires_at < now()
       AND COALESCE(tif_state,'') <> 'Executed'
       AND status NOT IN ('WIRE_PENDING_VERIFICATION','SETTLED_PAID')
     LIMIT 500
  LOOP
    BEGIN
      UPDATE public.closing_pipeline_items
         SET reservation_expires_at = NULL,
             reservation_started_at = NULL,
             reservation_email = NULL,
             tif_state = 'Expired',
             tif_expires_at = now() - interval '1 second'
       WHERE id = rec.id;

      IF rec.reservation_email IS NOT NULL THEN
        UPDATE public.buyer_scorecards
           SET reservation_expirations = reservation_expirations + 1,
               velocity_score = GREATEST(velocity_score - 15, 0),
               tier = CASE
                        WHEN reservation_expirations + 1 >= 3 AND deals_funded = 0 THEN 'Tier-3'
                        ELSE tier
                      END,
               last_event = 'RESERVATION_EXPIRED',
               last_activity_at = now()
         WHERE buyer_email = lower(rec.reservation_email);
      END IF;

      deal_id := rec.id; buyer_email := rec.reservation_email; action := 'REVOKED_RECASCADED';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;
END;
$$;
