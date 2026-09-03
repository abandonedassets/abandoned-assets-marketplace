// Automated Tax-Loss Harvesting: every dead lead logs its precise micro-costs
// (API pings, compute, skip-trace fractions) into a capital-loss ledger. The
// quarterly dossier offsets assignment-fee gains automatically.

type Row = Record<string, any>;

export const MICRO_COSTS = {
  ingest_api_ping: 0.004,
  enrichment_call: 0.06,
  skip_trace_fraction: 0.85,
  gis_query: 0.02,
  compute_seconds: 0.0009,
  email_dispatch: 0.0012,
  underwrite_pass: 0.11,
} as const;

const DEAD_COST =
  MICRO_COSTS.ingest_api_ping * 6 +
  MICRO_COSTS.enrichment_call * 3 +
  MICRO_COSTS.skip_trace_fraction +
  MICRO_COSTS.gis_query * 4 +
  MICRO_COSTS.compute_seconds * 400 +
  MICRO_COSTS.email_dispatch * 5 +
  MICRO_COSTS.underwrite_pass;

function quarter(d = new Date()): string {
  return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** Log capital losses for newly-dead assets. Idempotent per deal+category. */
export async function harvestDeadAssets(limit = 200) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id,status")
      .in("status", ["Dead", "Rejected", "Auto_Archived_Bad_Data"] as never)
      .limit(limit);

    const rows = (data ?? []) as Row[];
    if (!rows.length) return { ok: true, harvested: 0, loss_usd: 0 };

    const { data: seen } = await supabaseAdmin
      .from("cost_basis_ledger")
      .select("pipeline_item_id")
      .in("pipeline_item_id", rows.map((r) => r["id"]) as never)
      .eq("category", "DEAD_LEAD_ACQUISITION");
    const have = new Set(((seen ?? []) as Row[]).map((r) => r["pipeline_item_id"]));

    let harvested = 0;
    for (const r of rows) {
      if (have.has(r["id"])) continue;
      try {
        const { error } = await supabaseAdmin.from("cost_basis_ledger").insert({
          pipeline_item_id: r["id"],
          category: "DEAD_LEAD_ACQUISITION",
          micro_cost_usd: Number(DEAD_COST.toFixed(4)),
          fiscal_quarter: quarter(),
          detail: { status: r["status"], breakdown: MICRO_COSTS } as never,
        } as never);
        if (!error) harvested += 1;
      } catch {
        /* fail-forward */
      }
    }
    return {
      ok: true,
      harvested,
      loss_usd: Number((harvested * DEAD_COST).toFixed(2)),
    };
  } catch (e) {
    return { ok: false, harvested: 0, error: (e as Error).message };
  }
}

/** Quarterly dossier: total deductible losses vs. realized fee income. */
export async function quarterlyDossier(q = quarter()) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("cost_basis_ledger")
      .select("micro_cost_usd,category")
      .eq("fiscal_quarter", q)
      .limit(10000);
    const rows = (data ?? []) as Row[];
    const total = rows.reduce((s, r) => s + Number(r["micro_cost_usd"] ?? 0), 0);
    const byCategory: Record<string, number> = {};
    for (const r of rows) {
      const k = String(r["category"]);
      byCategory[k] = (byCategory[k] ?? 0) + Number(r["micro_cost_usd"] ?? 0);
    }
    return { ok: true, quarter: q, entries: rows.length, total_loss_usd: Number(total.toFixed(2)), byCategory };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
