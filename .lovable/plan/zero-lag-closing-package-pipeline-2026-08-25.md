# Zero-Lag Closing Package Pipeline

## 1. Lender Register button — no pre-flight, instant REGISTERED
- `LenderSyndication.tsx`: keep the save call, drop reliance on the server's list refetch to decide state. On click, optimistically append the row with status `REGISTERED` from the typed `lenderName`, `url`, `tokenEnv` — no browser request to the lender URL (there is no client fetch today; this locks that in).
- `lender-broadcast.server.ts` `saveLenderEndpoints`: stop rejecting hosts on connectivity/placeholder grounds at registration time. Keep only URL-parse + https checks; placeholder detection moves to broadcast time so a saved row is always stored and shown as `REGISTERED`.

## 2. In-house closing document engine
New `src/lib/closing-docs.server.ts` (pdf-lib, already installed):
- `buildBlindHud(deal)` — ALTA-style settlement statement with contract price, assignment spread, lien payoffs, net-to-seller line items; uses the existing `blind-hud.server.ts` directive text as the cover page.
- `buildDoubleCloseContracts(deal)` — A-B seller contract, B-C buyer contract, transactional funding disclosure.
- `buildEscrowInstructions(deal)` — pre-filled funding request + wire instructions stamped with the deal ID and EMD amount.
- `buildClosingBundle(dealId)` — merges all of the above into one PDF, SHA-256 checksum stamped in document metadata (same pattern as `report-pdf.server.ts`), uploads to storage and writes the URL + hash onto `closing_pipeline_items`.

## 3. Title API integration
- Extend `title-order.server.ts` to post the deal JSON to the Qualia-compatible endpoint (`TITLE_API_WEBHOOK_URL`, already wired) and attach the generated bundle URL in the payload; email stays as fallback only.
- New server route `src/routes/api/public/webhooks/title-commitment.ts`: HMAC-verified callback that stores the returned Title Commitment PDF URL and lien-search result on `title_packages` / `closing_pipeline_items` and flips `title_status`.

## 4. Automated e-signature dispatch
- Extend `esign.server.ts` with `dispatchClosingEnvelope(dealId)`: bundles generated closing package + title commitment and sends one envelope to buyer and seller. Uses DocuSign/Dropbox Sign when `ESIGN_API_KEY` is present, otherwise falls back to the existing in-house `/esign/$token` flow so the loop never stalls.

## 5. Pipeline wiring (parallel, fail-forward)
In `pipeline-chain.server.ts`, on deal trigger run in parallel via `Promise.allSettled`:
```text
Deal Trigger ──> buildClosingBundle (HUD + contracts + escrow)
             ├──> orderTitle (Qualia API order)
             └──> dispatchClosingEnvelope (e-sign)
```
Each leg wrapped in the existing `withRetry`; a failed leg logs to `system_alerts` and never blocks the others.

## Notes
- Runs on the existing TanStack server functions/routes (edge worker), not Supabase Edge Functions — pdf-lib works there today.
- Secrets needed for full external automation: `TITLE_API_WEBHOOK_URL`/`TITLE_API_KEY` and an e-sign provider key. Without them the in-house generation + fallback signing still completes end to end.
