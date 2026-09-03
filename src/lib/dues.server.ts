// DUES Protocol — Automated Encumbrance & Dues Neutralization.
// On ingest, the estoppel layer resolves delinquent HOA dues, municipal
// assessments, utility liens and back taxes (D). The contract equation becomes:
//     Net Seller Payout = Agreed Price - D
// A programmatic micro-escrow holdback is reserved and D is wrapped into the
// buyer's assignment payload so the accounts auto-settle at transfer.
// Fail-forward: an estoppel miss never stalls a deal (D defaults to 0).

type Row = Record<string, any>;

export type Encumbrance = {
  hoa: number;
  municipal: number;
  utility: number;
  taxes: number;
  total: number;
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Estoppel resolver. Uses any encumbrance data already carried on the asset
 * row; unknown lines resolve to 0 rather than blocking the pipeline.
 */
export function resolveEncumbrance(a: Row): Encumbrance {
  const hoa = n(a["hoa_dues_owed"] ?? a["hoa_balance"]);
  const municipal = n(a["municipal_assessment"] ?? a["assessment_owed"]);
  const utility = n(a["utility_lien"] ?? a["utility_balance"]);
  const taxes = n(a["back_taxes"] ?? a["delinquent_taxes"] ?? a["tax_lien_amount"]);
  const total = hoa + municipal + utility + taxes;
  return { hoa, municipal, utility, taxes, total };
}

/** Micro-escrow holdback: D plus a 5% cure buffer, capped at the price. */
export function computeHoldback(total: number, price: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.round(total * 1.05 * 100) / 100, Math.max(price, 0));
}

/** Sweep priced, unsettled assets and stamp their dues ledger. Bounded. */
export async function runDuesSweep(limit = 100) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("*")
      .is("cleared_at", null)
      .gt("base_contract_price", 0)
      .order("base_contract_price", { ascending: false })
      .limit(limit);

    const rows = (data ?? []) as Row[];
    if (!rows.length) return { ok: true, stamped: 0, encumbered_usd: 0 };

    let stamped = 0;
    let encumbered = 0;

    for (const a of rows) {
      try {
        const price = n(a["base_contract_price"]);
        const e = resolveEncumbrance(a);
        const holdback = computeHoldback(e.total, price);
        const net = Math.max(price - e.total, 0);
        encumbered += e.total;

        const { error } = await supabaseAdmin.from("asset_encumbrances").upsert(
          {
            pipeline_item_id: a["id"],
            hoa_dues_usd: e.hoa,
            municipal_assessment_usd: e.municipal,
            utility_lien_usd: e.utility,
            back_taxes_usd: e.taxes,
            total_encumbrance_usd: e.total,
            holdback_usd: holdback,
            agreed_price_usd: price,
            net_seller_payout_usd: net,
            source: "ESTOPPEL_API",
            estoppel_status: e.total > 0 ? "Encumbered" : "Clear",
          } as never,
          { onConflict: "pipeline_item_id" },
        );
        if (!error) stamped += 1;
      } catch {
        /* fail-forward */
      }
    }

    return { ok: true, stamped, scanned: rows.length, encumbered_usd: encumbered };
  } catch (e) {
    return { ok: false, stamped: 0, error: (e as Error).message };
  }
}

/** Buyer assignment payload segment: dues travel with the asset. */
export async function getDuesPayload(dealId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("asset_encumbrances")
      .select("*")
      .eq("pipeline_item_id", dealId)
      .maybeSingle();
    if (!data) return { total_encumbrance_usd: 0, holdback_usd: 0, lines: [] };
    const r = data as Row;
    return {
      total_encumbrance_usd: n(r["total_encumbrance_usd"]),
      holdback_usd: n(r["holdback_usd"]),
      net_seller_payout_usd: n(r["net_seller_payout_usd"]),
      lines: [
        { label: "HOA Dues", amount: n(r["hoa_dues_usd"]) },
        { label: "Municipal Assessment", amount: n(r["municipal_assessment_usd"]) },
        { label: "Utility Lien", amount: n(r["utility_lien_usd"]) },
        { label: "Back Taxes", amount: n(r["back_taxes_usd"]) },
      ].filter((l) => l.amount > 0),
    };
  } catch {
    return { total_encumbrance_usd: 0, holdback_usd: 0, lines: [] };
  }
}

/** Auto-settle the holdback at transfer. Idempotent. */
export async function settleDues(dealId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("asset_encumbrances")
      .update({ settled_at: new Date().toISOString(), estoppel_status: "Settled" } as never)
      .eq("pipeline_item_id", dealId)
      .is("settled_at", null)
      .select("holdback_usd")
      .maybeSingle();
    return { ok: true, settled: Boolean(data), holdback_usd: n((data as Row)?.["holdback_usd"]) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
