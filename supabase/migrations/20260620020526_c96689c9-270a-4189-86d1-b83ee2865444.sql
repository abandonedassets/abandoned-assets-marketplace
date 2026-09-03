
-- LOCKDOWN: Disable all state-mutating background jobs. Only Stripe webhook may move money state.
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN (
  'autonomous-auto-clear-1m',
  'autonomous-stripe-sync',
  'ghost-liquidity-decay',
  'scout-protocol-sweep',
  'observer-sweep-hourly',
  'match-resuscitate-sweep',
  'flow-orchestrator-72h',
  'shadow-escrow-drip',
  'auto-bundle-orphaned-assets',
  'auto-bundler-30min',
  'rebundle-stale-deals',
  'telemetry-heartbeat',
  'sweep-exception-queue',
  'data-refresh-sweep',
  'asset-refresh-rhythm',
  'tif-sweep-5min',
  'reverse-strike-dispatch',
  'buyer-matrix-sweep',
  'competitive-inventory-scan',
  'dlq-auto-retry',
  'autonomous-dlq-monitor'
);

-- Atomic Handshake: any item lacking a stripe_session_id is UNVERIFIED and excluded from balances.
ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS verification_status TEXT
  GENERATED ALWAYS AS (
    CASE WHEN stripe_session_id IS NULL OR stripe_session_id = '' THEN 'UNVERIFIED' ELSE 'VERIFIED' END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_cpi_verification_status
  ON public.closing_pipeline_items(verification_status);
