-- 1/2. Grants
GRANT SELECT, INSERT ON public.buyer_waitlist TO authenticated;
GRANT SELECT, INSERT ON public.conversion_events TO authenticated;
GRANT ALL ON public.buyer_waitlist TO service_role;
GRANT ALL ON public.conversion_events TO service_role;

-- anon is strictly append-only: INSERT privilege only, no SELECT/UPDATE/DELETE
REVOKE ALL ON public.buyer_waitlist FROM anon;
REVOKE ALL ON public.conversion_events FROM anon;
GRANT INSERT ON public.buyer_waitlist TO anon;
GRANT INSERT ON public.conversion_events TO anon;

-- 3/4. INSERT policies
DROP POLICY IF EXISTS "anon can append waitlist" ON public.buyer_waitlist;
CREATE POLICY "anon can append waitlist"
  ON public.buyer_waitlist FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated can append waitlist" ON public.buyer_waitlist;
CREATE POLICY "authenticated can append waitlist"
  ON public.buyer_waitlist FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon can append conversion events" ON public.conversion_events;
CREATE POLICY "anon can append conversion events"
  ON public.conversion_events FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated can append conversion events" ON public.conversion_events;
CREATE POLICY "authenticated can append conversion events"
  ON public.conversion_events FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "service role manages conversion events" ON public.conversion_events;
CREATE POLICY "service role manages conversion events"
  ON public.conversion_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);