-- Make concurrent retries with the same idempotency key return the same claim.
-- This migration changes only the claim-submit RPC; it does not create or recognize value.
create or replace function public.asset_nav_b2b_claim_submit_v1(p_claim jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_ein_creditor text;
  v_ein_debtor text;
  v_face numeric(18,2);
  v_terms text;
  v_maturity date;
  v_assignment boolean;
  v_assignment_ref text;
  v_hash text;
  v_provenance text;
  v_key text;
  v_fingerprint text;
  v_existing_fingerprint text;
  v_raw_creditor text;
  v_raw_debtor text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'INTAKE_CALLER_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_claim is null or jsonb_typeof(p_claim) <> 'object' then
    raise exception 'CLAIM_PAYLOAD_MUST_BE_OBJECT' using errcode = '22023';
  end if;

  v_raw_creditor := btrim(coalesce(p_claim->>'creditor_corporate_ein',''));
  v_raw_debtor := btrim(coalesce(p_claim->>'debtor_corporate_ein',''));
  if v_raw_creditor !~ '^[0-9]{2}-?[0-9]{7}$' or v_raw_debtor !~ '^[0-9]{2}-?[0-9]{7}$' then
    raise exception 'INVALID_EIN_FORMAT' using errcode = '22023';
  end if;
  v_ein_creditor := replace(v_raw_creditor, '-', '');
  v_ein_debtor := replace(v_raw_debtor, '-', '');
  if v_ein_creditor = v_ein_debtor then
    raise exception 'CREDITOR_AND_DEBTOR_MUST_DIFFER' using errcode = '22023';
  end if;

  begin
    v_face := (p_claim->>'invoice_face_value')::numeric(18,2);
    v_maturity := (p_claim->>'maturity_date')::date;
  exception when others then
    raise exception 'INVALID_FACE_VALUE_OR_MATURITY_DATE' using errcode = '22023';
  end;
  if v_face is null or v_face <= 0 then
    raise exception 'FACE_VALUE_MUST_BE_POSITIVE' using errcode = '22023';
  end if;

  v_terms := p_claim->>'net_payment_terms';
  if v_terms is null or v_terms not in ('NET-0','NET-15','NET-30','NET-45','NET-60','NET-90','OTHER_DOCUMENTED') then
    raise exception 'INVALID_PAYMENT_TERMS' using errcode = '22023';
  end if;
  if coalesce(p_claim->>'currency_code','USD') <> 'USD' then
    raise exception 'ONLY_USD_SUPPORTED' using errcode = '22023';
  end if;
  if jsonb_typeof(p_claim->'assignment_clause_present') <> 'boolean' then
    raise exception 'ASSIGNMENT_CLAUSE_BOOLEAN_REQUIRED' using errcode = '22023';
  end if;

  v_assignment := (p_claim->>'assignment_clause_present')::boolean;
  v_assignment_ref := nullif(btrim(p_claim->>'assignment_evidence_ref'),'');
  v_hash := lower(coalesce(p_claim->>'source_document_sha256',''));
  v_provenance := nullif(btrim(p_claim->>'source_provenance'),'');
  v_key := nullif(btrim(p_claim->>'idempotency_key'),'');
  v_fingerprint := lower(coalesce(p_claim->>'request_fingerprint',''));

  if v_assignment_ref is null or v_provenance is null then
    raise exception 'EVIDENCE_REFERENCE_AND_PROVENANCE_REQUIRED' using errcode = '22023';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_SOURCE_DOCUMENT_SHA256' using errcode = '22023';
  end if;
  if v_key is null or length(v_key) < 8 or length(v_key) > 200 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if v_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_FINGERPRINT' using errcode = '22023';
  end if;

  select id, request_fingerprint
    into v_id, v_existing_fingerprint
    from public.asset_nav_b2b_claims_v1
    where idempotency_key = v_key;

  if found then
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'claim_id',v_id,
      'claim_status','CLAIMED_DEBT_NOTE',
      'review_status','EXISTING_IDEMPOTENT_RECORD',
      'recognized_amount',0.00,
      'available_amount',0.00,
      'legal_assignability','UNVERIFIED'
    );
  end if;

  insert into public.asset_nav_b2b_claims_v1 (
    creditor_corporate_ein, debtor_corporate_ein, invoice_face_value, currency_code,
    net_payment_terms, maturity_date, days_past_maturity, assignment_clause_present,
    assignment_evidence_ref, source_document_sha256, source_provenance, idempotency_key, request_fingerprint
  ) values (
    v_ein_creditor, v_ein_debtor, v_face, 'USD', v_terms, v_maturity,
    greatest(current_date - v_maturity,0), v_assignment, v_assignment_ref, v_hash, v_provenance, v_key, v_fingerprint
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- A concurrent request won the unique-key race. Read its committed result.
    select id, request_fingerprint
      into v_id, v_existing_fingerprint
      from public.asset_nav_b2b_claims_v1
      where idempotency_key = v_key;

    if not found then
      raise exception 'IDEMPOTENCY_CONFLICT_RETRY_REQUIRED' using errcode = '40001';
    end if;
    if v_existing_fingerprint is distinct from v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' using errcode = '23505';
    end if;

    return jsonb_build_object(
      'claim_id',v_id,
      'claim_status','CLAIMED_DEBT_NOTE',
      'review_status','EXISTING_IDEMPOTENT_RECORD',
      'recognized_amount',0.00,
      'available_amount',0.00,
      'legal_assignability','UNVERIFIED'
    );
  end if;

  return jsonb_build_object(
    'claim_id',v_id,
    'claim_status','CLAIMED_DEBT_NOTE',
    'review_status','NEEDS_REVIEW',
    'recognized_amount',0.00,
    'available_amount',0.00,
    'legal_assignability','UNVERIFIED'
  );
end;
$function$;
