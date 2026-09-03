// POST /api/public/hooks/calculate-real-arv
// Zero-cost comps underwriter. Body: { id?: string, limit?: number }.
// Fail-forward: one bad asset never stalls the batch.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/calculate-real-arv")({
  server: {
    handlers: {
      GET: async () => run(null, 25),
      POST: async ({ request }) => {
        let id: string | null = null;
        let limit = 25;
        try {
          const b = (await request.json()) as { id?: string; limit?: number };
          id = b?.id ?? null;
          limit = Math.min(Math.max(Number(b?.limit ?? 25), 1), 100);
        } catch {
          /* empty body = batch default */
        }
        return run(id, limit);
      },
    },
  },
});

import { computeFeeMath, classifyAsset } from "@/lib/fee-matrix";

async function run(id: string | null, limit: number) {
  const started = Date.now();
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const arv = await import("@/lib/arv-comps.server");
    const { getFreePropertyInfo } = await import("@/lib/geo-free.server");

    let q = supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,address,city,state,county,zip,sqft,acreage,asset_type,zoning_category,timber_density_score,enrichment_tags,base_contract_price,estimated_repairs,arv_updated_at",
      );
    q = id
      ? q.eq("id", id)
      : q
          .in("status", ["New", "Pending-Underwriting", "Scout", "Auto-Enrichment-Pending", "Webhook_Dispatched"])
          .order("arv_updated_at", { ascending: true, nullsFirst: true })
          .limit(limit);

    const { data: rows } = await q;
    const results: Record<string, unknown>[] = [];

    for (const r of (rows ?? []) as Array<Record<string, any>>) {
      try {
        const sqft = Number(r["sqft"] ?? 0);
        const price = Number(r["base_contract_price"] ?? 0);
        const repairs = Number(r["estimated_repairs"] ?? 0);

        let lat: number | null = null;
        let lng: number | null = null;
        let county: string | null = r["county"] ?? null;
        if (r["address"]) {
          const geo = await getFreePropertyInfo(
            [r["address"], r["city"], r["state"], r["zip"]].filter(Boolean).join(", "),
          );
          if (geo.success) {
            lat = geo.lat ? Number(geo.lat) : null;
            lng = geo.lng ? Number(geo.lng) : null;
            county = county ?? geo.county ?? null;
          }
        }

        let comps = await arv.countyComps(r["state"] ?? null, county, lat, lng, sqft);
        let source: "COUNTY_REST" | "PUBLIC_GRAPHQL" | null = comps.length ? "COUNTY_REST" : null;
        if (!comps.length) {
          comps = await arv.publicSoldComps(String(r["zip"] ?? ""), sqft);
          source = comps.length ? "PUBLIC_GRAPHQL" : null;
        }

        const { arv: calculated } = arv.arvFromComps(comps, sqft);
        const basis = calculated ?? Math.round(price * 1.25);
        const cls = classifyAsset({
          asset_type: r["asset_type"],
          zoning_category: r["zoning_category"],
          enrichment_tags: Array.isArray(r["enrichment_tags"]) ? r["enrichment_tags"] : [],
          address: r["address"],
          sqft,
          acreage: r["acreage"],
          timber_density_score: r["timber_density_score"],
        });
        const m = computeFeeMath({ price, arv: basis, repairs, cls });
        const feePositive = m.is_fee_positive;
        const floor = m.absolute_floor_price;

        const patch: Record<string, unknown> = {
          calculated_arv: calculated,
          arv_source: source,
          arv_updated_at: new Date().toISOString(),
          arv_comp_count: comps.length,
          is_fee_positive: feePositive,
          optimized_acquisition_premium: m.target_fee,
        };
        // Land / lots / timber never carry a rehab budget.
        if (cls !== "IMPROVED") patch["estimated_repairs"] = 0;
        let recalibrated: number | null = null;
        if (!feePositive) {
          // DYNAMIC FEE RECALIBRATION — never silently drop the asset.
          // Find the minimum viable algorithmic spread the margin can carry.
          const MIN_VIABLE_FEE = 2_500;
          const viable = Math.floor(m.margin * 0.6);
          const tags: string[] = Array.isArray(r["enrichment_tags"]) ? r["enrichment_tags"] : [];

          if (viable >= MIN_VIABLE_FEE) {
            recalibrated = viable;
            patch["optimized_acquisition_premium"] = viable;
            patch["is_fee_positive"] = true;
            patch["status"] = "Webhook_Dispatched";
            patch["notification_queued"] = true;
            patch["enrichment_tags"] = [...new Set([...tags, "FEE_RECALIBRATED"])];
          } else {
            // No viable spread at this basis — arm the reverse strike at floor.
            patch["absolute_floor_price"] = floor;
            patch["status"] = "Pending-Underwriting";
            patch["enrichment_tags"] = [...new Set([...tags, "REVERSE_STRIKE_READY"])];
          }

          await supabaseAdmin.from("system_audit_logs").insert({
            pipeline_item_id: r["id"],
            event_type: recalibrated ? "FEE_RECALIBRATED" : "REVERSE_STRIKE_ARMED",
            reason: recalibrated
              ? `Autonomous recalibration: target fee ${m.target_fee} exceeded margin ${m.margin}; minimum viable spread set to ${recalibrated} and strike re-queued.`
              : `Margin ${m.margin} cannot carry the minimum viable spread; reverse strike armed at floor ${floor}.`,
            payload: {
              trigger_source: "calculate-real-arv",
              at: new Date().toISOString(),
              original_target_fee: m.target_fee,
              margin: m.margin,
              recalibrated_fee: recalibrated,
              floor,
            },
          } as never);
        }

        await supabaseAdmin.from("closing_pipeline_items").update(patch as never).eq("id", r["id"]);

        results.push({
          id: r["id"],
          calculated_arv: calculated,
          source,
          comps: comps.length,
          asset_class: cls,
          margin: m.margin,
          target_fee: m.target_fee,
          projected_cap_rate: m.projected_cap_rate,
          fee_positive: feePositive,
          floor: feePositive ? null : floor,
        });
      } catch (e) {
        results.push({ id: r["id"], error: (e as Error).message });
      }
    }

    return Response.json({ ok: true, scanned: results.length, ms: Date.now() - started, results });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
