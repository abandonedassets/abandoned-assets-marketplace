// POST /api/public/hooks/distress-triggers — deterministic pre-distress sweep.
// Hard public-record logic only (liens, tax burden, tenure, negative leverage).
// Flags actionable sellers and promotes qualifying rows off Pending-Underwriting.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/distress-triggers")({
  server: {
    handlers: {
      GET: async () => run(),
      POST: async () => run(),
    },
  },
});

async function run() {
  const started = Date.now();
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { distressTriggers } = await import("@/lib/t12.server");
    const alpha = await import("@/lib/alpha-score.server");

    const { data: rows } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,zip,assessed_value,estimated_repairs,base_contract_price,optimized_acquisition_premium,estimated_cap_rate,year_built,sqft,days_owned,lien_total,annual_property_tax,confidence_score,enrichment_tags,status",
      )
      .in("status", ["Pending-Underwriting", "Scout", "New", "Auto-Enrichment-Pending"])
      .limit(500);

    const regime = await alpha.loadRegime();
    const weights = await alpha.loadSubmarketWeights(null);
    let flagged = 0;
    let promoted = 0;

    for (const r of (rows ?? []) as Record<string, any>[]) {
      try {
        const flags = distressTriggers({
          t12: null,
          lien_total: r['lien_total'],
          annual_property_tax: r['annual_property_tax'],
          assessed_value: r['assessed_value'],
          days_owned: r['days_owned'],
          estimated_cap_rate: r['estimated_cap_rate'],
        });
        const zip = String(r['zip'] ?? "").slice(0, 5);
        const rank = alpha.compositeScore(r as never, regime, weights[zip] ?? 1);
        const risk = alpha.monteCarlo(r as never, String(r['id']), 2000);

        const tags: string[] = Array.isArray(r['enrichment_tags']) ? r['enrichment_tags'] : [];
        const next = new Set(tags);
        if (flags.tax_delinquency_trigger) next.add("TAX_DISTRESS");
        if (flags.loan_maturity_trigger) next.add("MATURITY_DISTRESS");
        if (flags.negative_leverage_trigger) next.add("NEGATIVE_LEVERAGE");
        if (flags.distress_score >= 50) next.add("ACTIONABLE_SELLER");

        const patch: Record<string, unknown> = {
          composite_score: rank.composite_score,
          risk_var_95: risk.risk_var_95,
          uw_ci_low: risk.uw_ci_low,
          uw_ci_high: risk.uw_ci_high,
          enrichment_tags: Array.from(next),
        };
        // Zero-friction: a scored, distressed asset never sits in underwriting limbo.
        if (rank.composite_score >= 60 || flags.distress_score >= 50) {
          patch['status'] = "Webhook_Dispatched";
          promoted++;
        }
        if (flags.distress_score >= 50) flagged++;

        await supabaseAdmin.from("closing_pipeline_items").update(patch as never).eq("id", r['id']);
      } catch (e) {
        console.error("[distress] row failed", (e as Error).message);
      }
    }

    return Response.json({
      ok: true,
      scanned: rows?.length ?? 0,
      flagged,
      promoted,
      latency_ms: Date.now() - started,
    });
  } catch (e) {
    console.error("[distress-triggers] failed", e);
    return Response.json({ ok: false, error: "unhandled" }, { status: 500 });
  }
}
