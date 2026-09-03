
ALTER FUNCTION public.tax_mitigation_multiplier(public.buyer_persona) SET search_path = public;
ALTER FUNCTION public.compute_buyer_urgency(numeric, timestamptz, public.buyer_persona) SET search_path = public;
