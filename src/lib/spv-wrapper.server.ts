// Anti-Deed Matrix: every dispatchable asset is wrapped in a single-member
// WY/DE SPV at ingest. Closing = Membership Interest Transfer Agreement (MITA),
// not a contract assignment. No transfer tax, no recorder latency.
// Fail-forward: a wrapper failure never blocks the pipeline.

type Row = Record<string, any>;

function entityName(a: Row): string {
  const seed =
    String(a["apn"] ?? "").replace(/\W/g, "") ||
    String(a["address"] ?? "").replace(/\W/g, "").slice(0, 10) ||
    String(a["id"]).slice(0, 8);
  return `Vault Asset ${seed.slice(-6).toUpperCase()} LLC`;
}

function jurisdiction(a: Row): "WY" | "DE" {
  return Number(a["base_contract_price"] ?? 0) >= 500_000 ? "DE" : "WY";
}

/** Provision SPV wrappers for unwrapped, priced assets. Bounded per run. */
export async function provisionSpvWrappers(limit = 50) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: assets } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id,apn,address,zip,base_contract_price")
      .is("cleared_at", null)
      .gt("base_contract_price", 0)
      .order("base_contract_price", { ascending: false })
      .limit(limit);

    const rows = (assets ?? []) as Row[];
    if (!rows.length) return { ok: true, wrapped: 0 };

    const { data: existing } = await supabaseAdmin
      .from("spv_wrappers")
      .select("pipeline_item_id")
      .in("pipeline_item_id", rows.map((r) => r["id"]) as never);
    const have = new Set(((existing ?? []) as Row[]).map((r) => r["pipeline_item_id"]));

    let wrapped = 0;
    for (const a of rows) {
      if (have.has(a["id"])) continue;
      try {
        const { error } = await supabaseAdmin.from("spv_wrappers").insert({
          pipeline_item_id: a["id"],
          entity_name: entityName(a),
          jurisdiction: jurisdiction(a),
          registered_agent: "AUTOMATED_RA_API",
          formation_status: "Provisioned",
        } as never);
        if (!error) wrapped += 1;
      } catch {
        /* fail-forward */
      }
    }
    return { ok: true, wrapped, scanned: rows.length };
  } catch (e) {
    return { ok: false, wrapped: 0, error: (e as Error).message };
  }
}

/** Stamp the MITA execution on the wrapper when a buyer is locked. */
export async function executeMita(dealId: string, buyerId: string | null) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("spv_wrappers")
      .update({
        mita_executed_at: new Date().toISOString(),
        mita_buyer_id: buyerId,
        formation_status: "Transferred",
      } as never)
      .eq("pipeline_item_id", dealId)
      .select("id, entity_name")
      .maybeSingle();
    return { ok: true, wrapper: data ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
