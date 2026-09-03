CREATE OR REPLACE VIEW public.partner_pipeline_view
WITH (security_invoker = true) AS
SELECT
  id,
  COALESCE(address, zip) AS property_address,
  optimized_acquisition_premium,
  status,
  partner_share AS parity_proxy,
  active_owner,
  routing_rule,
  updated_at
FROM public.closing_pipeline_items
WHERE active_owner = 'Partner';

GRANT SELECT ON public.partner_pipeline_view TO authenticated;