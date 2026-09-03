
ALTER TABLE public.conversion_events REPLICA IDENTITY FULL;
ALTER TABLE public.buyer_waitlist REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversion_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.buyer_waitlist;
