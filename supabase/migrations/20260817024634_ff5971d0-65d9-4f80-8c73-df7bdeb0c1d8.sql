ALTER TABLE public.closing_pipeline_items DROP COLUMN verification_status;
ALTER TABLE public.closing_pipeline_items ADD COLUMN verification_status text
GENERATED ALWAYS AS (
  CASE
    WHEN stripe_session_id IS NULL OR stripe_session_id = '' THEN 'UNVERIFIED'
    WHEN stripe_session_id LIKE 'BV-%' OR stripe_session_id LIKE 'bv_%' OR stripe_session_id LIKE 'BV_%' THEN 'VERIFIED_DIRECT_WIRE'
    ELSE 'VERIFIED'
  END
) STORED;
UPDATE public.inbound_wire_accounts SET status = 'VERIFIED_DIRECT_WIRE', updated_at = now() WHERE status = 'open';