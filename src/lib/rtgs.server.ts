// Real-Time Gross Settlement drawdown: the millisecond the fee is sealed in
// fee_escrow_locks, pull the fiat over FedNow/RTP. 24/7/365, fail-forward.

export type Drawdown = {
  initiated: boolean;
  rail: string;
  provider_ref: string | null;
  amount_usd: number;
  error?: string;
};

export async function initiateDrawdown(input: {
  dealId: string;
  txnId: string;
  amountUsd: number;
  network: string;
  reference: string;
  railUrl?: string | null;
}): Promise<Drawdown> {
  const rail = input.railUrl || process.env["RTGS_DRAWDOWN_URL"];
  const amount = Number(input.amountUsd || 0);
  const base: Drawdown = { initiated: false, rail: input.network, provider_ref: null, amount_usd: amount };
  if (!(amount > 0)) return { ...base, error: "zero_amount" };


  let providerRef: string | null = null;
  try {
    if (rail) {
      const res = await fetch(rail, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": input.txnId,
          ...(process.env["RTGS_API_KEY"] ? { authorization: `Bearer ${process.env["RTGS_API_KEY"]}` } : {}),
        },
        body: JSON.stringify({
          amount_usd: amount,
          network: input.network,
          source_reference: input.reference,
          memo: `Assignment fee ${input.dealId.slice(0, 8)}`,
        }),
      });
      if (!res.ok) throw new Error(`rail_${res.status}`);
      const j = (await res.json().catch(() => ({}))) as Record<string, any>;
      providerRef = String(j["id"] ?? j["reference"] ?? "") || null;
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("fee_escrow_locks")
      .update({ lock_state: rail ? "DRAWDOWN_INITIATED" : "LOCKED" } as never)
      .eq("client_txn_id", input.txnId);
    return { ...base, initiated: Boolean(rail), provider_ref: providerRef };
  } catch (e) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("execution_dlq").insert({
        deal_id: input.dealId,
        client_txn_id: input.txnId,
        reason: "RTGS_DRAWDOWN_FAILED",
        detail: { message: (e as Error).message, amount_usd: amount } as any,
      } as never);
    } catch {}
    return { ...base, error: (e as Error).message };
  }
}

/**
 * Cold storage sweep: never let the API-facing hot account accumulate.
 * Sweeps everything above the float threshold to the air-gapped treasury.
 */
export async function runColdStorageSweep(): Promise<Record<string, unknown>> {
  const threshold = Number(process.env["COLD_SWEEP_THRESHOLD_USD"] ?? 50_000);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data } = await supabaseAdmin
    .from("fee_escrow_locks")
    .select("id, assignment_fee")
    .in("lock_state", ["LOCKED", "DRAWDOWN_INITIATED", "RECONCILED"] as never)
    .is("swept_at", null)
    .limit(500);

  const rows = (data ?? []) as Record<string, any>[];
  const pool = rows.reduce((s, r) => s + Number(r["assignment_fee"] ?? 0), 0);
  if (pool < threshold) return { ok: true, swept: 0, pool_usd: Number(pool.toFixed(2)), threshold };

  const url = process.env["COLD_TREASURY_SWEEP_URL"];
  let providerRef: string | null = null;
  try {
    if (url) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env["RTGS_API_KEY"] ? { authorization: `Bearer ${process.env["RTGS_API_KEY"]}` } : {}),
        },
        body: JSON.stringify({ amount_usd: Number(pool.toFixed(2)), destination: "COLD_MULTISIG" }),
      });
      if (!res.ok) throw new Error(`sweep_${res.status}`);
      const j = (await res.json().catch(() => ({}))) as Record<string, any>;
      providerRef = String(j["id"] ?? "") || null;
    }
    const at = new Date().toISOString();
    await supabaseAdmin
      .from("fee_escrow_locks")
      .update({ swept_at: at } as never)
      .in("id", rows.map((r) => r["id"]) as never);
    await supabaseAdmin.from("system_audit_log").insert({
      table_name: "cold_storage_sweep",
      operation: "SWEEP",
      row_id: null,
      new_data: { amount_usd: Number(pool.toFixed(2)), provider_ref: providerRef, at } as never,
    } as never);
    return { ok: true, swept: rows.length, amount_usd: Number(pool.toFixed(2)), provider_ref: providerRef };
  } catch (e) {
    return { ok: false, error: (e as Error).message, pool_usd: Number(pool.toFixed(2)) };
  }
}
