// Institutional load harness — proves the pull-model execute rail under
// high-throughput conditions: N concurrent HMAC-signed strikes against distinct
// live assets, with a deliberate duplicate-fire slice to prove idempotency.

import { canonicalString, signCanonical } from "./m2m-hmac.server";

const BURST_LABEL = "UAT BURST HARNESS (LOAD)";

export type BurstResult = {
  requested: number;
  fired: number;
  accepted: number;
  replayed: number;
  rejected: number;
  duplicates_fired: number;
  duplicates_caught: number;
  reject_reasons: Record<string, number>;
  wall_ms: number;
  tps: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  error: string | null;
};

async function ensureBurstCredentials() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { randomBytes, createHash } = await import("crypto");

  const { data: existing } = await supabaseAdmin
    .from("institutional_api_keys")
    .select("id, key_prefix, hmac_secret")
    .eq("label", BURST_LABEL)
    .maybeSingle();
  const e = existing as Record<string, any> | null;
  if (e?.["hmac_secret"])
    return { key_id: String(e["key_prefix"]), secret: String(e["hmac_secret"]) };

  const keyId = `brst_${randomBytes(6).toString("hex")}`;
  const secret = randomBytes(32).toString("hex");
  const row = {
    label: BURST_LABEL,
    key_prefix: keyId,
    key_hash: createHash("sha256").update(secret).digest("hex"),
    hmac_secret: secret,
    sandbox: true,
    is_active: true,
    rate_limit_per_minute: 1_000_000,
  };
  if (e) {
    await supabaseAdmin.from("institutional_api_keys").update(row as never).eq("id", e["id"]);
  } else {
    const { error } = await supabaseAdmin.from("institutional_api_keys").insert(row as never);
    if (error) throw new Error(error.message);
  }
  return { key_id: keyId, secret };
}

const pct = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]! : 0;

/**
 * Fires `count` signed executions (bounded per invocation) at `concurrency`.
 * Every 10th strike re-fires the previous transaction id to exercise the
 * idempotency guard exactly as a double-firing HFT client would.
 */
export async function runBurst(input: {
  origin: string;
  count: number;
  concurrency?: number;
}): Promise<BurstResult> {
  const t0 = Date.now();
  const requested = Math.max(1, Math.min(500, Math.floor(input.count || 50)));
  const concurrency = Math.max(1, Math.min(50, input.concurrency ?? 20));
  const out: BurstResult = {
    requested,
    fired: 0,
    accepted: 0,
    replayed: 0,
    rejected: 0,
    duplicates_fired: 0,
    duplicates_caught: 0,
    reject_reasons: {},
    wall_ms: 0,
    tps: 0,
    p50_ms: 0,
    p95_ms: 0,
    max_ms: 0,
    error: null,
  };

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { randomUUID } = await import("crypto");
    const cred = await ensureBurstCredentials();

    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id")
      .is("cleared_at", null)
      .gt("optimized_acquisition_premium", 0)
      .order("optimized_acquisition_premium", { ascending: false })
      .limit(requested);
    const deals = ((data ?? []) as { id: string }[]).map((d) => d.id);
    if (deals.length === 0) throw new Error("no_executable_assets");

    const path = "/api/public/v1/execute";
    const latencies: number[] = [];
    let cursor = 0;
    let lastTxn: string | null = null;

    const fire = async (dealId: string, txnId: string, dup: boolean) => {
      const body = JSON.stringify({ deal_id: dealId, signature: txnId, burst: true });
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = signCanonical(canonicalString("POST", path, ts, body), cred.secret);
      const s = Date.now();
      try {
        const r = await fetch(`${input.origin}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-M2M-Key-Id": cred.key_id,
            "X-M2M-Timestamp": ts,
            "X-M2M-Signature": sig,
            "X-Client-Txn-Id": txnId,
          },
          body,
        });
        latencies.push(Date.now() - s);
        out.fired++;
        const replay = r.headers.get("x-idempotent-replay") === "true";
        if (replay) {
          out.replayed++;
          if (dup) out.duplicates_caught++;
        } else if (r.ok) {
          out.accepted++;
        } else {
          out.rejected++;
          const txt = await r.text().catch(() => "");
          let reason = String(r.status);
          try {
            const j = JSON.parse(txt);
            reason = String(j.error ?? j.reason ?? r.status);
          } catch {
            /* non-json */
          }
          out.reject_reasons[reason] = (out.reject_reasons[reason] ?? 0) + 1;
        }
      } catch (e) {
        out.fired++;
        out.rejected++;
        const reason = e instanceof Error ? e.message : "network";
        out.reject_reasons[reason] = (out.reject_reasons[reason] ?? 0) + 1;
      }
    };

    const worker = async () => {
      for (;;) {
        const i = cursor++;
        if (i >= requested) return;
        const dealId = deals[i % deals.length]!;
        const dup = i > 0 && i % 10 === 0 && lastTxn;
        if (dup) {
          out.duplicates_fired++;
          await fire(dealId, lastTxn as string, true);
        } else {
          const txn = `brst-${randomUUID()}`;
          lastTxn = txn;
          await fire(dealId, txn, false);
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));

    latencies.sort((a, b) => a - b);
    out.wall_ms = Date.now() - t0;
    out.tps = out.wall_ms > 0 ? Number((out.fired / (out.wall_ms / 1000)).toFixed(2)) : 0;
    out.p50_ms = pct(latencies, 0.5);
    out.p95_ms = pct(latencies, 0.95);
    out.max_ms = latencies.length ? latencies[latencies.length - 1]! : 0;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    out.wall_ms = Date.now() - t0;
  }

  return out;
}
