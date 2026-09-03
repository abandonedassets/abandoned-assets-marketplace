// POST /api/public/hooks/exchange-match — the 1031 Distress-Match Clearinghouse.
// Pulls active Qualified-Intermediary buy boxes with a live 45-day clock and
// pushes pre-underwritten distressed assets straight at them, newest deadline
// first. IRS three-property rule enforced (max 3 identifications per buyer).
// Fail-forward: every row is wrapped; one bad asset never stalls the sweep.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/exchange-match")({
  server: {
    handlers: {
      GET: async () => run(),
      POST: async () => run(),
    },
  },
});

const MIN_SCORE = 80;
const FALLBACK_SCORE = 60;
const THREE_PROPERTY_RULE = 3;


async function run() {
  const started = Date.now();
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nowIso = new Date().toISOString();

    const { data: boxes } = await supabaseAdmin
      .from("buyer_buy_boxes")
      .select(
        "id,buyer_id,label,qi_entity,exchange_deadline_at,target_zip_codes,target_asset_types,max_contract_price,min_placement_margin,capital_to_deploy_usd",
      )
      .eq("active", true)
      .eq("is_1031_buyer", true)
      .gt("exchange_deadline_at", nowIso)
      .order("exchange_deadline_at", { ascending: true })
      .limit(100);

    const results: Record<string, unknown>[] = [];
    let dispatched = 0;

    for (const b of (boxes ?? []) as Record<string, any>[]) {
      try {
        const deadline = String(b['exchange_deadline_at']);
        const daysLeft = Math.max(
          0,
          Math.ceil((Date.parse(deadline) - Date.now()) / 86400_000),
        );

        const { count: already } = await supabaseAdmin
          .from("closing_pipeline_items")
          .select("id", { count: "exact", head: true })
          .eq("matched_buy_box_id", b['id']);
        const slots = THREE_PROPERTY_RULE - (already ?? 0);
        if (slots <= 0) {
          results.push({ buy_box_id: b['id'], skipped: "three_property_rule_met" });
          continue;
        }

        const zips: string[] = Array.isArray(b['target_zip_codes']) ? b['target_zip_codes'] : [];
        const types: string[] = Array.isArray(b['target_asset_types']) ? b['target_asset_types'] : [];
        const maxPrice = Number(b['max_contract_price']) || 0;

        const pick = async (minScore: number, economicsOnly = false) => {
          let q = supabaseAdmin
            .from("closing_pipeline_items")
            .select(
              "id,address,city,state,zip,asset_type,sqft,calculated_arv,base_contract_price,optimized_acquisition_premium,assessed_value,estimated_repairs,composite_score,enrichment_tags,acreage,timber_density_score,lien_total,status",
            )
            // 1031 capital preempts a generic standing-buy-box soft match:
            // only a prior exchange identification (or a contracted status)
            // makes an asset untouchable.
            .is("exchange_identified_at", null)
            // Compliance lock: no signed marketing authorization = no
            // assignment. Marketing an asset without it is unlicensed
            // brokerage in most states.
            .eq("has_signed_marketing_auth", true)
            .in("status", [
              "Pending-Underwriting",
              "Webhook_Dispatched",
              "Shadow_Matched",
              "New",
            ])
            .lte("base_contract_price", maxPrice)
            .order("composite_score", { ascending: false })
            .limit(slots);
          // Economics tier: qualification is the asset-class target fee.
          if (economicsOnly) q = q.gt("optimized_acquisition_premium", 0);
          else q = q.gte("composite_score", minScore);
          if (zips.length) q = q.in("zip", zips.slice(0, 400));
          if (types.length) q = q.in("asset_type", types);
          const { data } = await q;
          const { computeFeeMath } = await import("@/lib/fee-matrix");
          const { classifyAllocation } = await import("@/lib/allocation-matrix");
          // Every tier must clear the asset-class dynamic fee floor.
          return ((data ?? []) as Record<string, any>[]).filter((a) => {
            // Title X screen: never place restricted 1-2 unit SFH stock
            // unless it sits in an exempt BTR pipeline.
            const alloc = classifyAllocation({
              asset_type: a['asset_type'],
              enrichment_tags: a['enrichment_tags'],
              address: a['address'],
              sqft: a['sqft'],
              acreage: a['acreage'],
            });
            (a as Record<string, unknown>)['_alloc'] = alloc;
            if (!alloc.compliant) return false;
            const price = Number(a['base_contract_price'] ?? 0);
            const arv = Number(a['calculated_arv'] ?? 0) || Math.round(price * 1.25);
            const m = computeFeeMath({
              price,
              arv,
              repairs: a['estimated_repairs'],
              asset: {
                asset_type: a['asset_type'],
                enrichment_tags: a['enrichment_tags'],
                address: a['address'],
                sqft: a['sqft'],
                acreage: a['acreage'],
                timber_density_score: a['timber_density_score'],
              },
            });
            (a as Record<string, unknown>)['_fee'] = m;
            return m.is_fee_positive;
          });
        };

        // Waterfall: institutional bar → working threshold → economic floor,
        // so exchange capital on a live clock never idles.
        let assets = await pick(MIN_SCORE);
        if (!assets.length) assets = await pick(FALLBACK_SCORE);
        if (!assets.length) assets = await pick(0, true);


        for (const a of assets) {
          try {
            const { likeKindMetadata } = await import("@/lib/qi");
            const meta = likeKindMetadata({
              is1031: true,
              qiEntity: b['qi_entity'] ?? null,
              deadlineAt: deadline,
              acreage: a['acreage'],
              timberDensityScore: a['timber_density_score'],
              contractPrice: a['base_contract_price'],
              lienTotal: a['lien_total'],
            });

            const tags: string[] = Array.isArray(a['enrichment_tags']) ? a['enrichment_tags'] : [];
            const nextTags = Array.from(new Set([...tags, "1031_IDENTIFIED", "CLEARINGHOUSE"]));

            await supabaseAdmin
              .from("closing_pipeline_items")
              .update({
                matched_buyer_id: b['buyer_id'],
                matched_buy_box_id: b['id'],
                is_1031_candidate: true,
                like_kind_eligible: !!meta.like_kind_eligible,
                qi_entity: b['qi_entity'] ?? null,
                exchange_deadline_at: deadline,
                exchange_identified_at: new Date().toISOString(),
                buyer_channel: "1031_CLEARINGHOUSE",
                optimized_acquisition_premium: (a['_fee']?.target_fee ?? a['optimized_acquisition_premium']),
                status: "Webhook_Dispatched",
                enrichment_tags: nextTags,
              } as never)
              .eq("id", a['id'])
              .is("exchange_identified_at", null);

            const { syndicateAsset } = await import("@/lib/syndication.server");
            const res = await syndicateAsset({
              id: String(a['id']),
              address: a['address'] ?? null,
              city: a['city'] ?? null,
              state: a['state'] ?? null,
              zip: a['zip'] ?? null,
              asset_type: a['asset_type'] ?? null,
              base_contract_price: a['base_contract_price'] ?? null,
              optimized_acquisition_premium: a['optimized_acquisition_premium'] ?? null,
              matched_buyer_id: String(b['buyer_id']),
              buyer_tier_stage: "1031_priority",
            });

            await supabaseAdmin
              .from("conversion_events")
              .insert({
                event: "1031_identification_dispatch",
                pipeline_item_id: a['id'],
                channel: "clearinghouse",
                metadata: {
                  buy_box_id: b['id'],
                  qi_entity: b['qi_entity'] ?? null,
                  days_remaining: daysLeft,
                  buy_link: res.buy_link,
                  like_kind: meta,
                } as never,
              } as never)
              .then(
                () => null,
                () => null,
              );

            dispatched++;
            results.push({
              buy_box_id: b['id'],
              deal_id: a['id'],
              days_remaining: daysLeft,
              composite_score: a['composite_score'],
              target_fee: a['_fee']?.target_fee ?? null,
              projected_cap_rate: a['_fee']?.projected_cap_rate ?? null,
              buy_link: res.buy_link,
            });
          } catch (e) {
            console.error("[exchange-match] asset failed", (e as Error).message);
          }
        }

        if (!assets.length) {
          results.push({ buy_box_id: b['id'], skipped: "no_matching_inventory", days_remaining: daysLeft });
        }
      } catch (e) {
        console.error("[exchange-match] box failed", (e as Error).message);
      }
    }

    return Response.json({
      ok: true,
      buy_boxes: boxes?.length ?? 0,
      dispatched,
      results: results.slice(0, 100),
      latency_ms: Date.now() - started,
    });
  } catch (e) {
    console.error("[exchange-match] failed", e);
    return Response.json({ ok: false, error: "unhandled" }, { status: 500 });
  }
}
