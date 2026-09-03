// ---------------------------------------------------------------------------
// Outbound escrow order engine + non-repudiation status worker.
//
//  * Contract hash  — SHA-256 over buyer id + property id + price + timestamp.
//                     Injected into the outbound title-company ping metadata
//                     and re-verified on every status pull. A silent term
//                     change at the title company trips HASH_MISMATCH and the
//                     deal can never be marked Funds-Cleared from that path.
//  * Execution jitter — the 08:00 worker spreads its pings across a
//                     randomized window so no two runs are predictable.
//  * Circuit breaker — two consecutive title-API failures halt the order and
//                     flag the queue instead of hammering the endpoint.
// ---------------------------------------------------------------------------

import { createHash, randomInt } from "crypto";

const JITTER_MIN_SEC = 12; // 08:00:12
const JITTER_MAX_SEC = 165; // 08:02:45
const FAILURE_TRIP_THRESHOLD = 2;
const BATCH_LIMIT = 25;
const PING_TIMEOUT_MS = 12_000;

function secret(): string {
  return (
    process.env["INBOUND_WIRE_SECRET"] ??
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
    "unsalted-dev"
  );
}

function sha256(parts: (string | number | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex");
}

/** Non-repudiation anchor for a contract. Deterministic given the same inputs. */
export function contractHash(input: {
  buyerId: string | null;
  propertyId: string;
  price: number;
  timestamp: string;
}): string {
  return sha256([
    "escrow-order",
    input.buyerId,
    input.propertyId,
    input.price.toFixed(2),
    input.timestamp,
    secret(),
  ]);
}

function jitterDelayMs(): number {
  return (JITTER_MIN_SEC + randomInt(0, JITTER_MAX_SEC - JITTER_MIN_SEC + 1)) * 1000;
}

async function postJson(url: string, body: unknown) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 2000) };
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// 1. Asymmetric escrow ping — fires the moment an asset clears.
// ---------------------------------------------------------------------------

export async function openEscrowOrder(dealId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: deal } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id, matched_buyer_id, apn, parcel_number, address, zip, base_contract_price, cleared_at, cleared_amount, settlement_reference, title_company_of_record, title_order_ref",
    )
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) return { ok: false, reason: "deal_not_found" };
  const d = deal as any;
  if (!d.cleared_at || !d.settlement_reference) return { ok: false, reason: "not_settlement_anchored" };

  const tco = (d.title_company_of_record ?? {}) as Record<string, any>;
  const titleApiUrl: string | null = tco.api_url ?? tco.webhook_url ?? null;
  const price = Number(d.cleared_amount ?? d.base_contract_price ?? 0);
  const stamp = String(d.cleared_at);
  const hash = contractHash({
    buyerId: d.matched_buyer_id ?? null,
    propertyId: String(d.apn ?? d.parcel_number ?? d.id),
    price,
    timestamp: stamp,
  });

  // Idempotent: one escrow order per deal.
  const { data: existing } = await supabaseAdmin
    .from("escrow_orders")
    .select("id, order_status")
    .eq("deal_id", dealId)
    .maybeSingle();
  if (existing) return { ok: true, reason: "already_open", order_id: (existing as any).id, contract_hash: hash };

  const payload = {
    event: "OPEN_ESCROW_ORDER",
    deal_id: d.id,
    property: { apn: d.apn ?? d.parcel_number ?? null, address: d.address ?? null, zip: d.zip ?? null },
    buyer_id: d.matched_buyer_id ?? null,
    purchase_price_usd: price,
    settlement_reference: d.settlement_reference,
    cleared_at: stamp,
    metadata: { contract_hash: hash, hash_algo: "sha256" },
  };

  let dispatched = false;
  let response: any = null;
  if (titleApiUrl) {
    try {
      const r = await postJson(titleApiUrl, payload);
      dispatched = r.ok;
      response = { status: r.status, body: r.json };
    } catch (e) {
      response = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  const next = new Date(Date.now() + jitterDelayMs()).toISOString();
  const { data: row } = await supabaseAdmin
    .from("escrow_orders")
    .insert({
      deal_id: dealId,
      title_company: tco.name ?? tco.company ?? null,
      title_api_url: titleApiUrl,
      order_status: dispatched ? "OPEN_REQUESTED" : titleApiUrl ? "DISPATCH_FAILED" : "AWAITING_TITLE_ENDPOINT",
      contract_hash: hash,
      opened_at: dispatched ? new Date().toISOString() : null,
      failure_count: dispatched || !titleApiUrl ? 0 : 1,
      next_ping_at: next,
      last_response: response,
    } as never)
    .select("id")
    .maybeSingle();

  return { ok: true, order_id: (row as any)?.id ?? null, dispatched, contract_hash: hash };
}

// ---------------------------------------------------------------------------
// 2. The 08:00 status-request worker — jittered, circuit-broken, verifying.
// ---------------------------------------------------------------------------

export async function runEscrowStatusWorker() {
  const out = {
    ok: true,
    scanned: 0,
    pinged: 0,
    verified: 0,
    mismatches: 0,
    tripped: 0,
    skipped_jitter: 0,
    errors: [] as string[],
  };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("escrow_orders")
    .select("id, deal_id, title_api_url, contract_hash, order_status, ping_count, failure_count, next_ping_at")
    .eq("circuit_state", "CLOSED")
    .is("closing_disclosure_url", null)
    .not("title_api_url", "is", null)
    .order("next_ping_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT);
  if (error) return { ...out, ok: false, errors: [error.message] };

  for (const raw of (data ?? []) as any[]) {
    out.scanned += 1;
    // Execution jitter: each order carries its own randomized due time.
    if (raw.next_ping_at && raw.next_ping_at > nowIso) {
      out.skipped_jitter += 1;
      continue;
    }

    try {
      const r = await postJson(raw.title_api_url as string, {
        event: "ESCROW_STATUS_REQUEST",
        deal_id: raw.deal_id,
        metadata: { contract_hash: raw.contract_hash, hash_algo: "sha256" },
      });
      out.pinged += 1;

      if (!r.ok) {
        const failures = Number(raw.failure_count ?? 0) + 1;
        const trip = failures >= FAILURE_TRIP_THRESHOLD;
        if (trip) out.tripped += 1;
        await supabaseAdmin
          .from("escrow_orders")
          .update({
            failure_count: failures,
            circuit_state: trip ? "OPEN" : "CLOSED",
            order_status: trip ? "HALTED_TITLE_API_FAILURE" : raw.order_status,
            last_ping_at: new Date().toISOString(),
            next_ping_at: new Date(Date.now() + 86_400_000 + jitterDelayMs()).toISOString(),
            last_response: { status: r.status, body: r.json },
          } as never)
          .eq("id", raw.id);
        continue;
      }

      const body = r.json ?? {};
      const returned = String(body.contract_hash ?? body.metadata?.contract_hash ?? "");
      const mismatch = returned.length > 0 && returned !== raw.contract_hash;
      if (mismatch) out.mismatches += 1;
      else if (returned) out.verified += 1;

      const cd = body.closing_disclosure_url ?? body.closing_disclosure ?? null;

      await supabaseAdmin
        .from("escrow_orders")
        .update({
          ping_count: Number(raw.ping_count ?? 0) + 1,
          failure_count: 0,
          hash_mismatch: mismatch,
          order_status: mismatch
            ? "HALTED_HASH_MISMATCH"
            : cd
              ? "CLOSING_DISCLOSURE_RECEIVED"
              : String(body.status ?? "AWAITING_CLOSING_DISCLOSURE"),
          circuit_state: mismatch ? "OPEN" : "CLOSED",
          closing_disclosure_url: cd,
          last_ping_at: new Date().toISOString(),
          next_ping_at: new Date(Date.now() + 86_400_000 + jitterDelayMs()).toISOString(),
          last_response: body,
        } as never)
        .eq("id", raw.id);

      if (mismatch) {
        const { appendLedger } = await import("@/lib/event-ledger.server");
        await appendLedger({
          entity: "escrow_orders",
          entityId: raw.id,
          operation: "ESCROW_HASH_MISMATCH",
          actor: "escrow_status_worker",
          after: { deal_id: raw.deal_id, expected: raw.contract_hash, returned },
        });
      }
    } catch (e) {
      // Fail-forward: one bad title endpoint never stalls the batch.
      out.errors.push(`${raw.id}: ${e instanceof Error ? e.message : String(e)}`);
      const failures = Number(raw.failure_count ?? 0) + 1;
      const trip = failures >= FAILURE_TRIP_THRESHOLD;
      if (trip) out.tripped += 1;
      await supabaseAdmin
        .from("escrow_orders")
        .update({
          failure_count: failures,
          circuit_state: trip ? "OPEN" : "CLOSED",
          order_status: trip ? "HALTED_TITLE_API_FAILURE" : raw.order_status,
          last_ping_at: new Date().toISOString(),
          next_ping_at: new Date(Date.now() + 86_400_000 + jitterDelayMs()).toISOString(),
        } as never)
        .eq("id", raw.id);
    }
  }

  return out;
}

/** Sweep: open escrow orders for every settlement-anchored deal that has none. */
export async function sweepClearedDealsIntoEscrow(limit = 20) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("id")
    .not("cleared_at", "is", null)
    .not("settlement_reference", "is", null)
    .limit(limit);

  const results: { deal_id: string; ok: boolean; reason?: string }[] = [];
  for (const row of (data ?? []) as any[]) {
    try {
      const r = await openEscrowOrder(row.id);
      results.push({ deal_id: row.id, ok: !!r.ok, reason: (r as any).reason });
    } catch (e) {
      results.push({ deal_id: row.id, ok: false, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok: true, opened: results.filter((r) => r.ok).length, results };
}
