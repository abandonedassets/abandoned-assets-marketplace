# B2B intake recovery rollout

## Current boundary

This PR is unmerged and must not be treated as deployed. The active Render service auto-deploys commits to `main`; merging the PR therefore changes the live application. The Supabase migrations and Edge Function source are not deployed by the Render build.

No production migration, Edge Function deployment, valid signed intake, or payment execution is authorized by this document.

## Required order

1. **Review the PR and green CI.** Confirm the latest head commit has passing pull-request checks and review the migration/function diffs. Do not merge a stale commit.
2. **Apply database migrations to the B2B target project** `midneoocykeoquxkjkrg` in order:
   - `20261011210000_b2b_claim_idempotency_race_recovery_v1.sql`
   - `20261011213000_b2b_intake_durable_status_recovery_v1.sql`
   Confirm the function definitions, service-role-only execute grants, and migration records are present afterward. Do not create synthetic claim rows as a migration test.
3. **Deploy the Edge Function** `asset-nav-b2b-debt-intake-v1` from the exact reviewed PR head. Confirm the deployed version includes canonical signature validation, compatibility with existing replay hashes, JSON status lookup, and the service-role-only status RPC. Run only non-mutating checks at this stage.
4. **Merge the reviewed application PR to `main`.** This is the Render deployment trigger. Render auto-deploys commits to `main`; do not trigger a duplicate manual deploy. Wait for the new deployment to become live and confirm its commit SHA.
5. **Verify the Render bridge key pair without submitting intake.** Sign in as an authorized application administrator and use **Verify bridge signing key**. It must report a match. A mismatch is a hard stop; do not attempt an intake. This check is necessarily post-deployment because the diagnostic is part of the reviewed application change.
6. **Run non-mutating live checks.** Verify the public intake page, health endpoint, unauthenticated POST rejection, admin-only key-pair diagnostic, and status lookup for a nonexistent key (must return `found:false`). Confirm no claim/document/audit rows were created by these probes.
7. **Run a separately authorized synthetic intake test** only after the live configuration checks pass. Use a clearly synthetic document and authorized test identities. Confirm one claim, one private object, one document metadata link, correct SHA-256, and audit evidence. Retry with the same key and exact payload; confirm the same claim/document IDs and no duplicate records. Confirm a changed payload with the same key is rejected. Do not infer recognized or available funds from intake acceptance.
8. **Test interrupted recovery.** With the same synthetic idempotency key, confirm status lookup after a simulated lost response. If the claim exists but its document link is missing, retry only with the exact original metadata and original file. Never generate a new key to hide an ambiguous outcome.

## Stop conditions

Stop and investigate if any of the following occurs:
- CI fails or the PR head changes after review.
- Application and server Supabase project URLs conflict.
- The bridge private key does not verify against the configured public key.
- A status request fails signature/replay validation or the status RPC is unavailable.
- Same-key/same-payload retry produces a different claim ID, duplicate object, or duplicate document link.
- Same-key/different-payload reuse is accepted.
- Any result reports nonzero recognized/available amount without independent authorized evidence.
- A payment, transfer, or external financial action is triggered by intake.

## Financial boundary

The intake flow creates and recovers evidence/review records only. It does not establish assignment, enforceability, collectibility, recognition, available funds, Mercury credit, or Chime transfer. External execution must be verified independently from the relevant provider's authoritative records.
