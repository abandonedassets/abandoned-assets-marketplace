DROP POLICY IF EXISTS "anon can append waitlist" ON public.buyer_waitlist;
DROP POLICY IF EXISTS "anon can append conversion events" ON public.conversion_events;
DROP POLICY IF EXISTS "authenticated can append waitlist" ON public.buyer_waitlist;
CREATE POLICY "authenticated append buyer_waitlist" ON public.buyer_waitlist FOR INSERT TO authenticated WITH CHECK (public.inbound_liquidity_open());
DROP POLICY IF EXISTS "authenticated can append conversion events" ON public.conversion_events;
CREATE POLICY "authenticated append conversion_events" ON public.conversion_events FOR INSERT TO authenticated WITH CHECK (public.inbound_liquidity_open());