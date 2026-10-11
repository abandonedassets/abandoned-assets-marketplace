-- Durable, minimal recovery lookup for an authenticated bridge caller.
-- This reports intake state only; it does not recognize or make funds available.
create or replace function public.asset_nav_b2b_claim_status_v1(p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'INTAKE_CALLER_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_idempotency_key is null
     or length(btrim(p_idempotency_key)) < 8
     or length(btrim(p_idempotency_key)) > 200 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'found', true,
    'claim_id', c.id,
    'claim_status', c.claim_status,
    'review_status', c.review_status,
    'document_linked', d.id is not null,
    'document_object_id', d.id,
    'document_sha256', c.source_document_sha256,
    'original_document_stored', d.id is not null,
    'recognized_amount', 0.00,
    'available_amount', 0.00,
    'legal_assignability', 'UNVERIFIED',
    'external_execution', false
  )
  into v_result
  from public.asset_nav_b2b_claims_v1 c
  left join public.asset_nav_b2b_document_objects_v1 d
    on d.claim_id = c.id
   and d.source_document_sha256 = c.source_document_sha256
  where c.idempotency_key = btrim(p_idempotency_key)
  limit 1;

  return coalesce(v_result, jsonb_build_object('found', false));
end;
$function$;

revoke all on function public.asset_nav_b2b_claim_status_v1(text) from public, anon, authenticated;
grant execute on function public.asset_nav_b2b_claim_status_v1(text) to service_role;
