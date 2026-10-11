-- Prevent replay of an already accepted Ed25519 bridge signature.
-- Signature digests are retained for ten minutes; stale rows are pruned on each consume.
create table if not exists public.asset_nav_b2b_bridge_replay_v1 (
  signature_sha256 text primary key check (signature_sha256 ~ '^[0-9a-f]{64}$'),
  seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.asset_nav_b2b_bridge_replay_v1 enable row level security;
revoke all on public.asset_nav_b2b_bridge_replay_v1 from public, anon, authenticated;
grant all on public.asset_nav_b2b_bridge_replay_v1 to service_role;

create or replace function public.asset_nav_b2b_consume_signature_v1(p_signature_sha256 text)
returns boolean language plpgsql
set search_path = pg_catalog, public
as $function$
declare v_inserted integer;
begin
  if p_signature_sha256 is null or p_signature_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid signature digest' using errcode = '22023';
  end if;
  delete from public.asset_nav_b2b_bridge_replay_v1 where expires_at <= clock_timestamp();
  insert into public.asset_nav_b2b_bridge_replay_v1(signature_sha256, expires_at)
  values (p_signature_sha256, clock_timestamp() + interval '10 minutes')
  on conflict (signature_sha256) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$function$;
revoke execute on function public.asset_nav_b2b_consume_signature_v1(text) from public, anon, authenticated;
grant execute on function public.asset_nav_b2b_consume_signature_v1(text) to service_role;
