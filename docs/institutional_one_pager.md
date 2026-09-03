# Institutional Execution Venue — One-Page Spec

**Headless, API-first network operator terminal for un-routed mobility and distressed real assets.**

## Mechanics
- **Pull model.** The counterparty's algorithm calls us. No human in the loop, no dashboard dependency.
- **Auth.** HMAC-SHA256 request signing (`X-M2M-Key-Id`, `X-M2M-Timestamp`, `X-M2M-Signature`) with a 300s replay window, plus asymmetric ECDSA non-repudiation signatures on production keys.
- **Idempotency.** `X-Client-Txn-Id` is unique-keyed server side; a replayed strike returns the byte-identical original response with `X-Idempotent-Replay: true`.
- **Payload-embedded capital.** Every strike must carry a clearing-network token (FEDNOW / RTP / STABLECOIN / WIRE). No token, no vault door.

## Deterministic response contract
| Condition | Status | Behavior |
|---|---|---|
| No capital token / underfunded vs assignment fee | `402` | Strike rejected, asset untouched |
| Rail authorization exceeds 500ms TTL | `408` | Poison pill; `asset_state: RELEASED_TO_QUEUE` |
| Deal already cleared | `409` | No double-assignment |
| Limit price exceeded (`max_assignment_fee`) | `409` | Limit-order semantics |
| Funded token clears | `200` | Atomic seal: fee locked, RTGS drawdown initiated |

## Settlement
Execution *is* settlement. On `200`, the assignment fee is cryptographically sealed (HMAC over deal id, txn id, fee, notional, timestamp) into the escrow ledger in the same millisecond, and the fiat pull is initiated over FedNow/RTP — 24/7/365, no invoice, zero days pending. Measured atomic seal latency: **~104ms**.

## Safety
- Out-of-band dead-letter reconciliation sweeps orphans and variances every 10 minutes.
- Cold-storage sweep wires cleared balances above threshold to the air-gapped treasury.
- Proof-of-escrow: signed, self-verifying balance snapshot bound to each deal — verify the HMAC instead of trusting an operator-asserted number.
- BGP-anycast ready; sub-second bi-directional venue heartbeat on the tape stream.

## Pilot: fire the crucible
```bash
curl -X POST https://<venue-host>/api/public/v1/uat/capital-crucible \
  -H "x-internal-uat-key: <issued-key>" \
  -H "content-type: application/json" \
  -d '{}'
```
Returns the four-case matrix: missing token (402), underfunded token (402), 900ms rail lag (408 + release), funded token (200 + sealed fee). Zero fiat movement; synthetic capital is state-segregated as `UAT_SIMULATED` and is ignored by the reconciler and treasury sweep.

## FedWire strike payload schema (`POST /api/public/v1/execute`)

Headers:
```
X-M2M-Key-Id:     pk_live_<fund>
X-M2M-Timestamp:  <unix seconds, ±300s>
X-M2M-Signature:  hex(HMAC-SHA256(secret, "METHOD\nPATH\nTIMESTAMP\nBODY"))
X-Client-Txn-Id:  <uuid, unique per strike — idempotency key>
X-M2M-Ecdsa:      <base64 DER over the canonical string>  # if asymmetric enforced
Content-Type:     application/json
```

Body:
```json
{
  "deal_id": "1c366c88-0000-0000-0000-000000000000",
  "execution_amount": 1.00,
  "max_assignment_fee": 25000,
  "capital_token": {
    "network": "WIRE",
    "imad": "F202608220000B000001G001",
    "amount": 1.00
  }
}
```

Field contract:
| Field | Type | Required | Notes |
|---|---|---|---|
| `deal_id` | uuid | yes | From the tape (`/api/v1/institutional-tape`) |
| `execution_amount` | number | no | Fallback for `capital_token.amount` |
| `max_assignment_fee` | number | no | Limit-order guard; `409 limit_exceeded` if breached |
| `capital_token.network` | enum | yes* | `FEDNOW` \| `RTP` \| `STABLECOIN` \| `WIRE`; implied `WIRE` when an IMAD/OMAD is present |
| `capital_token.imad` / `omad` / `fedwire_hash` / `reference` | string | yes | 12+ chars, `[A-Za-z0-9_-.]` — proof the push already left your desk |
| `capital_token.amount` | number | yes | Must cover the assignment fee |

Response (`200`): `state: SETTLED_ATOMIC`, `memo_id`, `assignment_fee`, `wire_instructions`, `escrow_proof`, `fee_lock`, `capital_token_hash`.
Replays of the same `X-Client-Txn-Id` return the byte-identical body with `X-Idempotent-Replay: true`.

**Order of operations:** push the wire → capture the IMAD/OMAD → strike with the hash. The vault opens on the hash, not on a promise.
