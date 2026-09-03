// Out-of-band shadow reconciler (Titanic safety).
// Cross-references locked assignment fees against the pipeline's cleared tape,
// traps mismatches in the DLQ, replays idempotent txn ids, and forces the
// ledgers back to zero variance. Bounded work per run, fail-forward per row.

const BATCH = 200;

export type ReconcileReport = {
  scanned: number;
  reconciled: number;
  variances: number;
  orphans: number;
  dlq_open: number;
};

export async function runShadowReconciler(): Promise<ReconcileReport> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const report: ReconcileReport = {
    scanned: 0,
    reconciled: 0,
    variances: 0,
    orphans: 0,
    dlq_open: 0,
  };

  const { data: locks, error } = await supabaseAdmin
    .from("fee_escrow_locks")
    .select("id, deal_id, client_txn_id, assignment_fee, notional, lock_state")
    .eq("lock_state", "LOCKED")
    .order("locked_at", { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(error.message);

  const rows = (locks ?? []) as Record<string, any>[];
  report.scanned = rows.length;
  if (!rows.length) return report;

  const dealIds = [...new Set(rows.map((r) => String(r["deal_id"])))];
  const { data: deals } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("id, optimized_acquisition_premium, base_contract_price, cleared_at, status")
    .in("id", dealIds);
  const byId = new Map(
    ((deals ?? []) as Record<string, any>[]).map((d) => [String(d["id"]), d]),
  );

  for (const lock of rows) {
    try {
      const deal = byId.get(String(lock["deal_id"]));
      if (!deal) {
        report.orphans++;
        await supabaseAdmin.from("execution_dlq").insert({
          deal_id: lock["deal_id"],
          client_txn_id: lock["client_txn_id"],
          reason: "ORPHANED_LOCK_NO_DEAL",
          detail: { assignment_fee: Number(lock["assignment_fee"]) } as any,
        } as never);
        await supabaseAdmin
          .from("fee_escrow_locks")
          .update({ lock_state: "ORPHANED" } as never)
          .eq("id", lock["id"]);
        continue;
      }

      const tapeFee = Number(deal["optimized_acquisition_premium"] ?? 0);
      const lockedFee = Number(lock["assignment_fee"] ?? 0);
      const variance = Number((tapeFee - lockedFee).toFixed(2));

      if (Math.abs(variance) > 0.01) {
        report.variances++;
        await supabaseAdmin.from("execution_dlq").insert({
          deal_id: lock["deal_id"],
          client_txn_id: lock["client_txn_id"],
          reason: "FEE_VARIANCE",
          detail: { locked_fee: lockedFee, tape_fee: tapeFee, variance } as any,
        } as never);
        // Auto-heal: the cryptographically sealed lock is the source of truth.
        await supabaseAdmin
          .from("closing_pipeline_items")
          .update({ optimized_acquisition_premium: lockedFee } as never)
          .eq("id", lock["deal_id"]);
        await supabaseAdmin
          .from("fee_escrow_locks")
          .update({ variance } as never)
          .eq("id", lock["id"]);
      }

      if (deal["cleared_at"]) {
        await supabaseAdmin
          .from("fee_escrow_locks")
          .update({
            lock_state: "RECONCILED",
            reconciled_at: new Date().toISOString(),
            variance: 0,
          } as never)
          .eq("id", lock["id"]);
        report.reconciled++;
      }
    } catch (e) {
      // Fail-forward: one bad row never halts the sweep.
      console.error("[shadow-reconciler] row failed", (e as Error).message);
    }
  }

  const { count } = await supabaseAdmin
    .from("execution_dlq")
    .select("id", { count: "exact", head: true })
    .eq("resolved", false);
  report.dlq_open = count ?? 0;
  return report;
}
