# Live-Only Buyer Dispatch Enforcement

Lock the dispatch engine to real, reachable buyer endpoints only. No synthetic domains, no fallback receivers.

## 1. Verification schema

Add to `buyer_buy_boxes` (idempotent, safe defaults):

- `endpoint_status` text, default `UNVERIFIED`
- `endpoint_checked_at` timestamptz
- `endpoint_last_code` integer

No existing data is changed by the migration itself.

## 2. Pre-flight ping helper

New helper called before any buyer dispatch:

- Issues HEAD, falls back to POST, 5s timeout
- HTTP 200–405 → `endpoint_status = 'VERIFIED'`, record code + timestamp, dispatch proceeds
- DNS/connection failure or timeout → `endpoint_status = 'UNREACHABLE'`, `active = false`, record error string in `offer_delivery_logs.meta`, no dispatch
- Re-check skipped if verified within the last 6 hours (keeps the 5-minute cron cheap)

Wired into the existing dispatch path used by the autonomous cycle.

## 3. Synthetic purge

Deactivate and clear every row whose `webhook_url` matches `hooks.synthetic-buyers.io`, `lovable.app`, or other loopback/test receivers. Remove mock-buyer fallback branches from dispatch code: zero matching real buyers means the asset holds on tape and nothing is sent.

Note: `httpbin.org` and `postman-echo.com` rows armed earlier are echo receivers, not real buyers — they are included in the purge unless you want them kept as smoke-test targets.

## 4. Corrected monitor query

Mapped to the real columns (`buyer_id`, `status`, `meta`):

```sql
SELECT id, buyer_id, status,
       meta->>'http_code'      AS returned_http_status,
       meta->>'error_message'  AS server_error_trace,
       created_at
FROM public.offer_delivery_logs
ORDER BY created_at DESC
LIMIT 50;
```

Optionally surfaced as a small admin panel reading the same data.

## Technical notes

- Migration adds columns only; GRANTs and RLS on `buyer_buy_boxes` are untouched.
- Ping helper is fail-forward: a helper error never throws into the cron; it logs and skips the buyer.
- Velocity cap (5 provisions/hour), manual Stripe payout binding, and parity split routing are unchanged.
