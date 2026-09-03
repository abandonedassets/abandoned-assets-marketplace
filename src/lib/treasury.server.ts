// Treasury routing: cleared assignment revenue is split 80% corporate reserve /
// 20% compute + gas reserve, and each split is journaled once per deal.
type Row = Record<string, any>;

export const TREASURY_SPLIT = { corporate_reserve: 0.8, compute_reserve: 0.2 } as const;

export async function runTreasuryRouting(limit = 100) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id,optimized_acquisition_premium,cleared_at")
      .not("cleared_at", "is", null)
      .order("cleared_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const rows = ((data ?? []) as Row[]).filter(
      (r) => Number(r["optimized_acquisition_premium"]) > 0,
    );
    if (!rows.length) return { ok: true, routed: 0, corporate_usd: 0, compute_usd: 0 };

    const { data: seen } = await supabaseAdmin
      .from("system_audit_log")
      .select("row_id")
      .eq("table_name", "treasury_split")
      .in("row_id", rows.map((r) => r["id"]) as never);
    const have = new Set(((seen ?? []) as Row[]).map((r) => r["row_id"]));

    let routed = 0;
    let corporate = 0;
    let compute = 0;

    for (const r of rows) {
      if (have.has(r["id"])) continue;
      const fee = Number(r["optimized_acquisition_premium"]) || 0;
      const corp = Number((fee * TREASURY_SPLIT.corporate_reserve).toFixed(2));
      const comp = Number((fee * TREASURY_SPLIT.compute_reserve).toFixed(2));
      try {
        const { error: insErr } = await supabaseAdmin.from("system_audit_log").insert({
          table_name: "treasury_split",
          operation: "ROUTE",
          row_id: r["id"],
          new_data: {
            fee_usd: fee,
            corporate_reserve_usd: corp,
            compute_reserve_usd: comp,
            cleared_at: r["cleared_at"],
          } as never,
        } as never);
        if (!insErr) {
          routed++;
          corporate += corp;
          compute += comp;
        }
      } catch {
        /* fail-forward */
      }
    }

    return {
      ok: true,
      routed,
      corporate_usd: Number(corporate.toFixed(2)),
      compute_usd: Number(compute.toFixed(2)),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
