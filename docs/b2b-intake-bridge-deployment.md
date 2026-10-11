# B2B intake bridge deployment and verification

## Trust boundary

- The Render route verifies the caller's token against the application Supabase project and requires `has_role(admin)`.
- The route signs the exact raw multipart body using Ed25519. The private PKCS#8 DER key is provided only through Render environment variable `B2B_INTAKE_BRIDGE_PRIVATE_KEY_B64`.
- The target Edge Function embeds only the corresponding public key, validates the body SHA-256 and a five-minute timestamp window, and then uses its own Supabase service-role key internally for the existing idempotent claim, storage, document-link, and audit operations.
- The Render service must not receive the target project's service-role key for this bridge.
- The target API key in the route is a Supabase publishable key, not a secret.
- The Edge Function has `verify_jwt = false) only because its request handler enforces the Ed25519 signature, exact body digest, HTTP method, function identifier, and timestamp before any claim operation. Do not disable this custom verification.

## Deployment order

1. Review and pass the PR's TypeScript, ESLint, and Deno checks.
2. Provision `B2B_INTAKE_BRIDGE_PRIVATE_KEY_B64` in Render from the approved secret record. Never commit the private key or put it in client-visible variables.
3. Deploy `asset-nav-b2b-debt-intake-v1` to project `midneoocykeoquxkjkrg` with `verify_jwt=false`, using the source in this repository. The repository's `supabase/config.toml` points to a separate app project, so specify the target project explicitly during deployment.
4. Deploy the Render route change. Do not merge or deploy until the secret and function version are coordinated; otherwise the route intentionally returns `503 B2B_INTAKE_BRIDGE_CONFIGURATION_INCOMPLETE`.
5. Verify unauthenticated and non-admin calls are denied; expired signatures, altered bodies, missing signatures, and malformed multipart requests fail closed; an authorized test upload produces a claim, stored object, matching SHA-256, linked document record, and audit events.
6. Repeat the exact same request with the same idempotency key. It must return the existing claim and document link without duplicate claim creation. Change one payload field with the same key and verify the database rejects the fingerprint collision.
7. Confirm every successful response still reports `recognized_amount = 0`, `available_amount = 0`, and `external_execution = false`. No payment, reconciliation, or funds-availability transition is part of intake.

## Recovery behavior

A timed-out or ambiguous submission retains its idempotency key. Retry the same metadata and same original file. Do not clear the key to bypass an unknown outcome; verify the persisted claim and document link before starting a separate claim.

## Current limitation

Source and key-pair consistency have been checked, but the live Edge Function has not yet been changed to this version, the Render private-key variable has not been provisioned, and no end-to-end upload has been run. Treat the feature as not deployment-ready until the ordered checks above pass.
