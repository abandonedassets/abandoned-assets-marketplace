-- 0. extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- 1. HASH LEDGER --------------------------------------------------------
ALTER TABLE public.conversion_events
  ADD COLUMN IF NOT EXISTS cryptographic_hash text,
  ADD COLUMN IF NOT EXISTS tx_idempotency_key text;

CREATE OR REPLACE FUNCTION public.ce_stamp_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.cryptographic_hash IS NULL OR NEW.cryptographic_hash = '' THEN
    NEW.cryptographic_hash := encode(
      extensions.digest(
        coalesce(to_jsonb(NEW)::text, '') || coalesce(NEW.created_at, now())::text,
        'sha256'
      ), 'hex');
  END IF;
  IF NEW.tx_idempotency_key IS NULL OR NEW.tx_idempotency_key = '' THEN
    NEW.tx_idempotency_key := NEW.cryptographic_hash;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_stamp_hash ON public.conversion_events;
CREATE TRIGGER trg_ce_stamp_hash
BEFORE INSERT ON public.conversion_events
FOR EACH ROW EXECUTE FUNCTION public.ce_stamp_hash();

-- backfill then lock NOT NULL
UPDATE public.conversion_events
SET cryptographic_hash = encode(extensions.digest(id::text || coalesce(created_at, now())::text, 'sha256'), 'hex')
WHERE cryptographic_hash IS NULL;

UPDATE public.conversion_events
SET tx_idempotency_key = cryptographic_hash
WHERE tx_idempotency_key IS NULL;

ALTER TABLE public.conversion_events
  ALTER COLUMN cryptographic_hash SET NOT NULL;

-- 2. IDEMPOTENCY --------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS conversion_events_tx_idempotency_key_uidx
  ON public.conversion_events (tx_idempotency_key);

-- immutability
CREATE OR REPLACE FUNCTION public.ce_block_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE LEDGER VIOLATION';
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_block_update ON public.conversion_events;
CREATE TRIGGER trg_ce_block_update
BEFORE UPDATE ON public.conversion_events
FOR EACH ROW EXECUTE FUNCTION public.ce_block_update();

-- 3. STALE SWEEP --------------------------------------------------------
ALTER TABLE public.buyer_waitlist
  ADD COLUMN IF NOT EXISTS is_stale boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.sweep_stale_buyer_waitlist()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.buyer_waitlist
     SET is_stale = true
   WHERE is_stale = false
     AND created_at < now() - interval '72 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  RETURN 0;
END;
$$;

SELECT cron.unschedule('sweep-stale-buyer-waitlist')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-stale-buyer-waitlist');

SELECT cron.schedule('sweep-stale-buyer-waitlist', '0 * * * *',
  $$SELECT public.sweep_stale_buyer_waitlist();$$);

-- 4. CIRCUIT BREAKER ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  accept_inbound_liquidity boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_state TO authenticated;
GRANT ALL ON public.system_state TO service_role;

ALTER TABLE public.system_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read system state" ON public.system_state;
CREATE POLICY "admins read system state" ON public.system_state
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "service role manages system state" ON public.system_state;
CREATE POLICY "service role manages system state" ON public.system_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.system_state (id, accept_inbound_liquidity)
VALUES (true, true)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_system_state_updated_at ON public.system_state;
CREATE TRIGGER trg_system_state_updated_at
BEFORE UPDATE ON public.system_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.inbound_liquidity_open()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT accept_inbound_liquidity FROM public.system_state LIMIT 1), true);
$$;

GRANT EXECUTE ON FUNCTION public.inbound_liquidity_open() TO anon, authenticated, service_role;

-- rebind anon insert policies to the breaker
DROP POLICY IF EXISTS "anon append buyer_waitlist" ON public.buyer_waitlist;
DROP POLICY IF EXISTS "anon can insert buyer_waitlist" ON public.buyer_waitlist;
CREATE POLICY "anon append buyer_waitlist" ON public.buyer_waitlist
  FOR INSERT TO anon
  WITH CHECK (public.inbound_liquidity_open());

DROP POLICY IF EXISTS "anon append conversion_events" ON public.conversion_events;
DROP POLICY IF EXISTS "anon can insert conversion_events" ON public.conversion_events;
CREATE POLICY "anon append conversion_events" ON public.conversion_events
  FOR INSERT TO anon
  WITH CHECK (public.inbound_liquidity_open());