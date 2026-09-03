ALTER TABLE public.closing_pipeline_items
  ADD COLUMN IF NOT EXISTS signed_contract_hash text,
  ADD COLUMN IF NOT EXISTS verified_counterparty_id text,
  ADD COLUMN IF NOT EXISTS title_escrow_file_number text;

-- Purge synthetic clearance artifacts (internally generated bank references,
-- internal escrow custody states and heuristic title clears).
UPDATE public.closing_pipeline_items
SET payout_provider_transfer_id = NULL,
    payout_provider = NULL,
    payout_status = NULL
WHERE payout_provider = 'BLUEVINE_INTERNAL_LEDGER'
   OR payout_provider_transfer_id LIKE 'INT%'
   OR payout_status = 'IN_TRANSIT_INTERNAL';

UPDATE public.closing_pipeline_items
SET escrow_status = NULL
WHERE escrow_status = 'INTERNAL_ESCROW_HELD';

DELETE FROM public.shadow_escrow_ledger
WHERE liquidity_state = 'INTERNAL_CUSTODY';

CREATE OR REPLACE FUNCTION public.realworld_gate_status(_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(btrim(c.signed_contract_hash), '') <> ''
     AND coalesce(btrim(c.verified_counterparty_id), '') <> ''
     AND coalesce(btrim(c.title_escrow_file_number), '') <> ''
    THEN 'GREEN_GO_VERIFIED'
    ELSE 'BLOCKED_AWAITING_REAL_WORLD_DATA'
  END
  FROM public.closing_pipeline_items c
  WHERE c.id = _id
$$;