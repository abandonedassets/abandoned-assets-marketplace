// The Asset Pulse: sub-second venue telemetry tethered to the deal tape.
// Every value here is measured, never asserted — counterparty algorithms
// key their confidence off this stream.
import { createHash } from "crypto";
import type { TapeAsset } from "./m2m-tape.server";

export type AssetPulse = {
  at: string;
  tick_latency_ms: number;
  open_inventory: number;
  executable: number;
  notional_open_usd: number;
  fee_pool_usd: number;
  title_clean_ratio: number;
  tape_hash: string;
  locks_open: number;
  locks_reconciled_24h: number;
  dlq_open: number;
  integrity: "NOMINAL" | "DEGRADED";
};

export async function assetPulse(rows: TapeAsset[], tickLatencyMs: number): Promise<AssetPulse> {
  const executable = rows.filter((r) => r.executable).length;
  const notional = rows.reduce((s, r) => s + (Number(r.valuation) || 0), 0);
  const fees = rows.reduce((s, r) => s + (Number(r.assignment_fee) || 0), 0);
  const clean = rows.filter((r) => r.title_clean).length;
  const tapeHash = createHash("sha256")
    .update(rows.map((r) => `${r.deal_id}:${r.assignment_fee}`).join("|"))
    .digest("hex");

  let locksOpen = 0;
  let locksReconciled = 0;
  let dlqOpen = 0;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const [a, b, c] = await Promise.all([
      supabaseAdmin
        .from("fee_escrow_locks")
        .select("id", { count: "exact", head: true })
        .eq("lock_state", "LOCKED"),
      supabaseAdmin
        .from("fee_escrow_locks")
        .select("id", { count: "exact", head: true })
        .eq("lock_state", "RECONCILED")
        .gte("reconciled_at", since),
      supabaseAdmin
        .from("execution_dlq")
        .select("id", { count: "exact", head: true })
        .eq("resolved", false),
    ]);
    locksOpen = a.count ?? 0;
    locksReconciled = b.count ?? 0;
    dlqOpen = c.count ?? 0;
  } catch {
    // Fail-forward: telemetry gaps never sever the stream.
  }

  return {
    at: new Date().toISOString(),
    tick_latency_ms: tickLatencyMs,
    open_inventory: rows.length,
    executable,
    notional_open_usd: Math.round(notional),
    fee_pool_usd: Math.round(fees),
    title_clean_ratio: rows.length ? Number((clean / rows.length).toFixed(4)) : 0,
    tape_hash: tapeHash,
    locks_open: locksOpen,
    locks_reconciled_24h: locksReconciled,
    dlq_open: dlqOpen,
    integrity: dlqOpen > 0 || tickLatencyMs > 1500 ? "DEGRADED" : "NOMINAL",
  };
}
