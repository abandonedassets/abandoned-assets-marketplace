# Autonomous Assignment-Fee Execution

## Goal
Make verified payment-provider events the sole authority for assignment-fee authorization, capture, settlement, and release, with idempotent retries and fail-forward recovery.

## Implementation
1. Trace the existing checkout, webhook, capture, payout, ledger, and deployment paths and remove database-only success transitions.
2. Establish one explicit payment state machine: pending → authorized → captured → settled, plus frozen/failed/refunded/disputed branches. Persist provider IDs and event IDs for idempotency.
3. Route every eligible deal through a real configured payment rail, verify provider signatures, and unlock assets only after the required verified event.
4. Add autonomous reconciliation for missed/out-of-order events and safe retry queues; never mark revenue earned until provider confirmation.
5. Validate the full flow with provider test transactions, database evidence, webhook logs, and the public health endpoint before enabling live execution.

## Technical constraints
- No database status may imply money moved without a matching provider reference and verified event.
- Never fabricate charges, bypass authorization, or initiate unauthorized debits.
- External callbacks remain signature-verified and idempotent.
- Runtime/provider configuration outside the repository must be healthy before live execution can be certified.
