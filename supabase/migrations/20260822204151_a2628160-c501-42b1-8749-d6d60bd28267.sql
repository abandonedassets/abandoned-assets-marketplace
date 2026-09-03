create table if not exists public.m2m_node_health (
  box_id uuid primary key references public.buyer_buy_boxes(id) on delete cascade,
  label text,
  webhook_url text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_status int,
  last_latency_ms int,
  last_error text,
  consecutive_failures int not null default 0,
  total_attempts bigint not null default 0,
  total_accepts bigint not null default 0,
  reachable boolean not null default false,
  updated_at timestamptz not null default now()
);
grant select on public.m2m_node_health to authenticated;
grant all on public.m2m_node_health to service_role;
alter table public.m2m_node_health enable row level security;
drop policy if exists "admins read node health" on public.m2m_node_health;
create policy "admins read node health" on public.m2m_node_health
  for select to authenticated using (public.has_role(auth.uid(),'admin'));

create table if not exists public.m2m_inbound_log (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  endpoint text not null,
  method text not null,
  ip text,
  user_agent text,
  api_key_prefix text,
  authorized boolean not null default false,
  box_label text,
  http_status int,
  latency_ms int,
  body_preview text,
  headers jsonb
);
create index if not exists m2m_inbound_log_recent on public.m2m_inbound_log (received_at desc);
grant select on public.m2m_inbound_log to authenticated;
grant all on public.m2m_inbound_log to service_role;
alter table public.m2m_inbound_log enable row level security;
drop policy if exists "admins read inbound log" on public.m2m_inbound_log;
create policy "admins read inbound log" on public.m2m_inbound_log
  for select to authenticated using (public.has_role(auth.uid(),'admin'));