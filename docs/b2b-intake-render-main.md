# B2B intake on the deployed Render branch

## Why this branch exists

The Render service `abandoned-assets-marketplace` tracks Git branch `main`, while the TanStack intake PR was merged into `production`. The branches have diverged and contain different application trees. Do not switch the live service to `production` merely to expose this route: that branch's Blueprint includes `AUTO_PAYOUT_ON_CLEAR=true` and a scheduled ledger-sweep service. This implementation instead adds the intake bridge to the existing `main` Nitro runtime.

## Runtime flow

1. `/api/public/b2b-intake-page` serves a standalone sign-in and intake page. It exposes only the application Supabase URL and public anon/publishable key.
2. The browser signs in against the application Supabase project and verifies `has_role(admin)`.
3. `POST /api/private/b2b-intake` independently validates the app token and admin role, then reads the multipart request with a 16 MiB cap.
4. The Render route signs the exact body bytes with `B2B_INTAKE_BRIDGE_PRIVATE_KEY_B64` and forwards to the target Edge Function.
5. The target function validates the Ed25519 signature, body SHA-256, function identifier, and five-minute timestamp window before processing the request.

The target service-role key remains inside Supabase. The Render route uses the application's service-role key only to validate the app user and role.

## Safety boundaries

- Intake creates a review record and document link only.
- Recognized and available amounts remain zero; no payment or external execution is triggered.
- An ambiguous submission retains its idempotency key; do not clear it to bypass an unknown outcome.
- The current Render service remains on `main`; this work does not switch branches or enable the production branch's automatic payout/cron configuration.

Nitro file scanning is explicitly enabled with `scanDirs: ["./server"]`. The Stripe settlement POST handler and unverified Mercury webhook POST handler are preserved under `disabled-server-routes/`, outside the active Nitro scan. The Mercury GET probe remains available. CI starts the built Nitro server locally and verifies the health route, Mercury probe, intake page, unauthenticated intake rejection, and that both financial webhook POST routes remain 404.

## Verification

The main-runtime CI builds the existing Nitro application with the new route. Before a real intake is used, verify sign-in, non-admin denial, unsigned/expired/tampered request rejection, file/hash/document linkage, and same-key retry using an authorized source document. No synthetic claim should be inserted solely for testing.
