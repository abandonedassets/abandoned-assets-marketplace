CREATE TABLE IF NOT EXISTS public.fee_escrow_locks (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  client_txn_id text not null,
  api_key_id uuid,
  counterparty text,
  assignment_fee numeric not null default 0,
  notional numeric not null default 0,
  seal_hash text not null,
  lock_state text not null default 'LOCKED',
  variance numeric not null default 0,
  locked_at timestamptz not null default now(),
  reconciled_at timestamptz,
  unique (client_txn_id)
);
CREATE INDEX IF NOT EXISTS idx_fee_locks_deal ON public.fee_escrow_locks(deal_id);
CREATE INDEX IF NOT EXISTS idx_fee_locks_state ON public.fee_escrow_locks(lock_state, locked_at DESC);
GRANT ALL ON public.fee_escrow_locks TO service_role;
GRANT SELECT ON public.fee_escrow_locks TO authenticated;
ALTER TABLE public.fee_escrow_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fee_locks_admin_read" ON public.fee_escrow_locks;
CREATE POLICY "fee_locks_admin_read" ON public.fee_escrow_locks FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.execution_dlq (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid,
  client_txn_id text,
  reason text not null,
  detail jsonb not null default '{}'::jsonb,
  replay_attempts int not null default 0,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_exec_dlq_open ON public.execution_dlq(resolved, created_at DESC);
GRANT ALL ON public.execution_dlq TO service_role;
GRANT SELECT ON public.execution_dlq TO authenticated;
ALTER TABLE public.execution_dlq ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "exec_dlq_admin_read" ON public.execution_dlq;
CREATE POLICY "exec_dlq_admin_read" ON public.execution_dlq FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));