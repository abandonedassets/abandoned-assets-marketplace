// "Pre-Crime" Predictive Staging: synthesize non-real-estate distress vectors
// to flag assets before they hit public delinquency lists.

type Row = Record<string, any>;

const VECTOR_WEIGHTS: Record<string, number> = {
  utility_shutoff: 35,
  obituary_surname_match: 30,
  usps_delivery_drop: 20,
  code_violation: 15,
  vacancy_signal: 15,
  absentee_owner: 10,
  long_tenure: 10,
};

export function scoreVectors(vectors: string[]): number {
  return Math.min(
    100,
    vectors.reduce((s, v) => s + (VECTOR_WEIGHTS[v] ?? 5), 0),
  );
}

function level(score: number): string {
  if (score >= 70) return "Pre-Distress Level 3";
  if (score >= 45) return "Pre-Distress Level 2";
  return "Pre-Distress Level 1";
}

/** Derive vectors from row telemetry already present on the asset. */
function deriveVectors(a: Row): string[] {
  const v: string[] = [];
  const tags: string[] = a["capital_tags"] ?? [];
  if (a["vacancy_flag"] || tags.includes("VACANT")) v.push("vacancy_signal");
  if (a["owner_occupied"] === false) v.push("absentee_owner");
  if (a["code_violation_count"] && Number(a["code_violation_count"]) > 0)
    v.push("code_violation");
  if (a["utility_shutoff"] === true) v.push("utility_shutoff");
  if (a["probate_flag"] === true) v.push("obituary_surname_match");
  if (a["mail_return_flag"] === true) v.push("usps_delivery_drop");
  return v;
}

/** Scan the tape, stage predicted distress, and pre-lock shadow capital. */
export async function runPreCrimeScan(limit = 100) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("*")
      .is("cleared_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    const rows = (data ?? []) as Row[];
    let staged = 0;
    for (const a of rows) {
      try {
        const vectors = deriveVectors(a);
        if (vectors.length < 2) continue;
        const score = scoreVectors(vectors);
        const staked = Math.round(Number(a["base_contract_price"] ?? 0) * 0.1);
        const { error } = await supabaseAdmin.from("pre_distress_signals").insert({
          pipeline_item_id: a["id"],
          apn: a["apn"] ?? null,
          zip: a["zip"] ?? null,
          vectors: vectors as never,
          score,
          level: level(score),
          staged_capital_usd: staked,
        } as never);
        if (!error) staged += 1;
      } catch {
        /* fail-forward */
      }
    }
    return { ok: true, scanned: rows.length, staged };
  } catch (e) {
    return { ok: false, staged: 0, error: (e as Error).message };
  }
}
