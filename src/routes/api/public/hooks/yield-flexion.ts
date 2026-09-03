import { createFileRoute } from "@tanstack/react-router";

// Dynamic Yield-Flexion Engine.
// Tier 1 (0-48h):  primary buy-box matching (handled elsewhere) — untouched.
// Tier 2 (48-168h): flex cap-rate / fee thresholds by 0.5% and retest, route to shadow queue.
// Tier 3 (>168h):   archive dead assets off the live tape.
// Fail-forward: every stage is wrapped; a failure never blocks the next asset.

export const Route = createFileRoute("/api/public/hooks/yield-flexion")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, note: "POST to run yield flexion" }),
      POST: async () => run(),
    },
  },
});

const FLEX = 0.005; // 0.5% fractional elasticity
const DEAD_STATUSES = ["Closed", "Dead", "Auto_Archived_Bad_Data", "Funds-Cleared"];

async function run() {
  const started = Date.now();
  let flexed = 0;
  let matched = 0;
  let shadowed = 0;
  let archived = 0;

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadActiveBuyBoxes, computeCapRate, matchBuyBoxes } = await import(
      "@/lib/buybox.server"
    );

    const now = Date.now();
    const h48 = new Date(now - 48 * 3600_000).toISOString();
    const h168 = new Date(now - 168 * 3600_000).toISOString();

    const boxes = await loadActiveBuyBoxes();
    // Secondary liquidity pool: same mandates, elastic yield + budget thresholds.
    const flexBoxes = boxes.map((b) => ({
      ...b,
      min_cap_rate: Math.max(0, Number(b.min_cap_rate) - FLEX),
      max_repair_budget: Number(b.max_repair_budget) * (1 + FLEX),
      max_hoa_monthly: Number(b.max_hoa_monthly) * (1 + FLEX),
    }));

    // ---- Tier 2: 48h - 168h unmatched ----
    const { data: stale } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,zip,beds,baths,sqft,year_built,has_garage,hoa_monthly,estimated_repairs,assessed_value,calculated_arv,base_contract_price,optimized_acquisition_premium,enrichment_tags,status,matched_fund_ids",
      )
      .is("matched_buy_box_id", null)
      .lt("created_at", h48)
      .gte("created_at", h168)
      .not("status", "in", `(${DEAD_STATUSES.join(",")})`)
      .limit(500);

    for (const raw of (stale ?? []) as Array<Record<string, any>>) {
      try {
        const traits = {
          zip: raw["zip"],
          beds: raw["beds"],
          baths: raw["baths"],
          sqft: raw["sqft"],
          year_built: raw["year_built"],
          has_garage: raw["has_garage"],
          hoa_monthly: raw["hoa_monthly"],
          estimated_repairs: raw["estimated_repairs"],
          assessed_value: raw["calculated_arv"] ?? raw["assessed_value"],
          base_contract_price: raw["base_contract_price"],
          optimized_acquisition_premium: raw["optimized_acquisition_premium"],
        };
        const capRate = computeCapRate(traits);
        const flexCap = capRate === null ? null : Number((capRate * (1 + FLEX)).toFixed(4));
        const hits = matchBuyBoxes(traits, flexBoxes as never, flexCap);

        const tags = new Set<string>([...(raw["enrichment_tags"] ?? []), "YIELD_FLEXED_T2"]);
        const patch: Record<string, unknown> = {
          estimated_cap_rate: capRate,
          enrichment_tags: Array.from(tags),
        };

        if (hits.length) {
          patch["matched_fund_ids"] = hits;
          tags.add("SECONDARY_POOL_MATCH");
          patch["enrichment_tags"] = Array.from(tags);
          matched++;
        } else {
          // Route to the shadow queue instead of stalling on the primary tape.
          patch["status"] = "Shadow_Inventory";
          shadowed++;
        }

        await supabaseAdmin
          .from("closing_pipeline_items")
          .update(patch as never)
          .eq("id", raw["id"]);
        flexed++;
      } catch (e) {
        console.error("[flexion] asset failed", raw["id"], (e as Error).message);
      }
    }

    // ---- Tier 3: >168h, still no match / no EMD signal ----
    try {
      const { data: dead } = await supabaseAdmin
        .from("closing_pipeline_items")
        .select("id,enrichment_tags,emd_amount,matched_fund_ids")
        .is("matched_buy_box_id", null)
        .lt("created_at", h168)
        .not("status", "in", `(${DEAD_STATUSES.join(",")})`)
        .limit(500);

      for (const raw of (dead ?? []) as Array<Record<string, any>>) {
        try {
          const hasEmd = Number(raw["emd_amount"] ?? 0) > 0;
          const hasFund = ((raw["matched_fund_ids"] ?? []) as string[]).length > 0;
          if (hasEmd || hasFund) continue;
          const tags = new Set<string>([
            ...(raw["enrichment_tags"] ?? []),
            "ARCHIVED_STALE_168H",
          ]);
          await supabaseAdmin
            .from("closing_pipeline_items")
            .update({
              status: "Auto_Archived_Bad_Data",
              enrichment_tags: Array.from(tags),
            } as never)
            .eq("id", raw["id"]);
          archived++;
        } catch (e) {
          console.error("[flexion] archive failed", raw["id"], (e as Error).message);
        }
      }
    } catch (e) {
      console.error("[flexion] tier3 query failed", (e as Error).message);
    }

    await supabaseAdmin
      .from("system_audit_logs")
      .insert({
        event_type: "YIELD_FLEXION_SWEEP",
        reason: `flexed=${flexed} matched=${matched} shadowed=${shadowed} archived=${archived}`,
        payload: { flexed, matched, shadowed, archived } as never,
      } as never)
      .then(undefined, () => {});
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
  }

  return Response.json({
    ok: true,
    ms: Date.now() - started,
    flexed,
    secondary_matches: matched,
    shadow_routed: shadowed,
    archived,
  });
}
