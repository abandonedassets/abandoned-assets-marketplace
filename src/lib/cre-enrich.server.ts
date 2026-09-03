// Commercial (CRE) enrichment sweep — stamps taxonomy, bps fee, dynamic
// cap-rate math, WALT/tenant credit, debt-maturity distress, zoning/FAR reuse
// potential, and Phase I environmental screening onto the deal tape.
// Fail-forward: a bad row never stalls the sweep.
import { enrichCre } from "@/lib/cre-taxonomy";

const SELECT =
  "id,address,asset_class,asset_type,zoning_category,zoning_class,enrichment_tags,base_contract_price,estimated_cap_rate,noi_usd,wale_years,walt_years,lien_total,title_status,acreage,sqft,env_status,env_flag_reason,cre_class,fee_bps,cre_lane,optimized_acquisition_premium";

export type CreSweepResult = {
  ok: true;
  scanned: number;
  stamped: number;
  commercial: number;
  distress: number;
  rollup_candidates: number;
  errors: number;
};

export async function runCreEnrichSweep(limit = 250): Promise<CreSweepResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: CreSweepResult = {
    ok: true,
    scanned: 0,
    stamped: 0,
    commercial: 0,
    distress: 0,
    rollup_candidates: 0,
    errors: 0,
  };

  const { data, error } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(SELECT)
    .is("cleared_at", null)
    .not("status", "in", '("Dead","Rejected","Closed","Auto_Archived_Bad_Data")')
    .order("cre_class", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })

    .limit(limit);
  if (error) {
    return { ...out, errors: 1 };
  }

  for (const row of (data ?? []) as Record<string, any>[]) {
    out.scanned++;
    try {
      const e = enrichCre(row);
      if (e.cre_class !== "NON_COMMERCIAL") out.commercial++;
      if (e.debt_distress_flag) out.distress++;
      if (e.cre_lane === "PORTFOLIO_ROLLUP") out.rollup_candidates++;

      // Replace prior CRE-derived tags so re-runs cannot compound stale taxonomy.
      const prior = (Array.isArray(row["enrichment_tags"]) ? row["enrichment_tags"] : []).filter(
        (t: string) =>
          !/^(CRE_|LANE_|PHASE1_CLEAR|DEBT_MATURITY_WALL|INVESTMENT_GRADE_TENANT|HIGH_FAR_POTENTIAL|ADAPTIVE_REUSE_BY_RIGHT|INDUSTRIAL_CONVERSION_CANDIDATE)/.test(
            String(t),
          ),
      );
      const tags = Array.from(new Set([...prior, ...e.tags]));

      const patch: Record<string, unknown> = {
        cre_class: e.cre_class,
        fee_bps: e.fee_bps || null,
        expense_ratio: e.expense_ratio,
        walt_years: e.walt_years,
        tenant_credit_tier: e.tenant_credit_tier,
        debt_maturity_date: e.debt_maturity_date,
        debt_distress_flag: e.debt_distress_flag,
        debt_distress_reason: e.debt_distress_reason,
        far_potential: e.far_potential,
        adaptive_reuse_by_right: e.adaptive_reuse_by_right,
        env_status: e.env_status,
        env_flag_reason: e.env_flag_reason,
        cre_lane: e.cre_lane,
        enrichment_tags: tags,
      };
      if (e.noi_usd != null) patch["noi_usd"] = e.noi_usd;
      if (e.estimated_cap_rate != null) patch["estimated_cap_rate"] = e.estimated_cap_rate;
      // Commercial lane prices the assignment fee in bps, not a flat target.
      if (e.cre_class !== "NON_COMMERCIAL" && e.target_fee_usd > 0) {
        patch["optimized_acquisition_premium"] = e.target_fee_usd;
      }

      const { error: upErr } = await supabaseAdmin
        .from("closing_pipeline_items")
        .update(patch as never)
        .eq("id", row["id"]);
      if (upErr) out.errors++;
      else out.stamped++;
    } catch {
      out.errors++;
    }
  }

  return out;
}
