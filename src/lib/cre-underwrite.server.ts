// Track B — Commercial (CRE) underwriting.
// Computes NOI, WALE and DSCR from carried valuation data, flags coverage
// breaches (< 1.15), and labels large positions for fractional packaging
// (DST / QOF). Fail-forward: a bad row never stalls the sweep.
import { parseCommercialMetrics } from "@/lib/bifurcation.server";

type Row = Record<string, any>;

export const DSCR_BREACH_THRESHOLD = 1.15;
export const FRACTIONAL_MIN_USD = 2_000_000;
const DEFAULT_DEBT_CONSTANT = 0.085; // annual debt service / loan basis
const DEFAULT_LTV = 0.7;

export function computeCreMetrics(row: Row) {
  const price = Number(row["base_contract_price"]) || 0;
  const parsed = parseCommercialMetrics(row);
  const capRate = Number(row["estimated_cap_rate"]) || 0;

  const noi =
    parsed.noi_usd ?? (price > 0 && capRate > 0 ? Number((price * capRate).toFixed(2)) : null);

  const debtService = price * DEFAULT_LTV * DEFAULT_DEBT_CONSTANT;
  const dscr = noi != null && debtService > 0 ? Number((noi / debtService).toFixed(3)) : null;

  const pkg =
    price >= FRACTIONAL_MIN_USD
      ? (row["enrichment_tags"] ?? []).some?.((t: string) => /QOZ|OPPORTUNITY/i.test(String(t)))
        ? "QOF"
        : "DST"
      : null;

  return {
    noi_usd: noi,
    wale_years: parsed.wale_years,
    dscr,
    dscr_breach: dscr != null && dscr < DSCR_BREACH_THRESHOLD,
    cre_package: pkg,
  };
}

/** Underwrite the commercial lane and stamp metrics on the tape. */
export async function runCreUnderwriteSweep(limit = 150) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,base_contract_price,estimated_cap_rate,enrichment_tags,buyer_channel,noi_usd,dscr,cre_package",
      )
      .eq("buyer_channel", "INSTITUTIONAL_1031")
      .is("cleared_at", null)
      .limit(limit);
    if (error) throw error;

    const rows = (data ?? []) as Row[];
    let stamped = 0;
    let breaches = 0;
    let fractional = 0;

    for (const r of rows) {
      try {
        const m = computeCreMetrics(r);
        if (m.dscr_breach) breaches++;
        if (m.cre_package) fractional++;
        if (
          Number(r["noi_usd"] ?? NaN) === Number(m.noi_usd ?? NaN) &&
          Number(r["dscr"] ?? NaN) === Number(m.dscr ?? NaN) &&
          (r["cre_package"] ?? null) === m.cre_package
        ) {
          continue;
        }
        const { error: upErr } = await supabaseAdmin
          .from("closing_pipeline_items")
          .update(m as never)
          .eq("id", r["id"]);
        if (!upErr) stamped++;
      } catch {
        /* fail-forward */
      }
    }

    return { ok: true, scanned: rows.length, stamped, dscr_breaches: breaches, fractional };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
