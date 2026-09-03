// Time-Decay Contract Ratcheting + Secondary Market Re-Auction Engine.
// 0-24h standard, 25-48h market-adjustment notice, 48h+ step-up or rescind.
// Rescinded/decayed offers do NOT die: the assignment fee is elastically
// scaled down 5% per cycle (floor 40% of the original) and the asset is
// re-queued to secondary buyer tiers and re-syndicated automatically.
import { createFileRoute } from "@tanstack/react-router";

const DECAY_STEP = 0.05;
const MAX_DECAY_STEPS = 12; // 5% x 12 => 60% total elasticity floor
const MIN_FEE_USD = 750;

async function reAuction(dealId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id,address,city,state,zip,asset_type,base_contract_price,optimized_acquisition_premium,matched_buyer_id,fee_decay_count,buyer_tier_stage,locked_at,cleared_at",
    )
    .eq("id", dealId)
    .maybeSingle();
  if (!data) return { deal_id: dealId, action: "skipped", reason: "not_found" };
  const d = data as any;
  if (d.cleared_at || d.locked_at)
    return { deal_id: dealId, action: "skipped", reason: "locked_or_cleared" };

  const steps = Number(d.fee_decay_count ?? 0);
  if (steps >= MAX_DECAY_STEPS)
    return { deal_id: dealId, action: "floor_reached", fee: d.optimized_acquisition_premium };

  const currentFee = Number(d.optimized_acquisition_premium ?? 0);
  const nextFee = Math.max(MIN_FEE_USD, Math.round(currentFee * (1 - DECAY_STEP)));

  const { error } = await supabaseAdmin
    .from("closing_pipeline_items")
    .update({
      optimized_acquisition_premium: nextFee,
      fee_decay_count: steps + 1,
      buyer_tier_stage: "secondary",
      status: "Webhook_Dispatched",
      offer_stage: "standard",
      offer_sent_at: new Date().toISOString(),
      offer_expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      matched_buyer_id: null,
      syndicated_at: null,
    } as never)
    .eq("id", dealId);
  if (error) return { deal_id: dealId, action: "reprice_failed", error: error.message };

  let syndication: unknown = null;
  try {
    const { syndicateAsset } = await import("@/lib/syndication.server");
    syndication = await syndicateAsset({
      ...d,
      optimized_acquisition_premium: nextFee,
      buyer_tier_stage: "secondary",
      matched_buyer_id: null,
    });
  } catch (e) {
    console.error("[offer-ratchet] re-syndication failed", e);
  }

  return {
    deal_id: dealId,
    action: "re_auctioned",
    fee_from: currentFee,
    fee_to: nextFee,
    decay_step: steps + 1,
    tier: "secondary",
    syndication,
  };
}

export const Route = createFileRoute("/api/public/hooks/offer-ratchet")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to run the ratchet sweep" }),
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("sweep_offer_ratchet" as never);
          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 200 });
          }
          const rows = (data ?? []) as any[];

          // Notify on every 25-48h adjustment so the seller feels the clock.
          for (const r of rows.filter((x) => x.action === "market_adjustment_notice")) {
            try {
              const { notifyAdmin } = await import("@/lib/notify.server");
              await notifyAdmin(
                `Expiring Market Adjustment — deal ${r.deal_id} re-prices in 24 hours.`,
              );
            } catch (e) {
              console.error("[offer-ratchet] notify failed", e);
            }
          }

          // Secondary Market Re-Auction: decayed/rescinded offers get elastic
          // fee compression and an automatic re-dispatch to secondary tiers.
          const reAuctions = [];
          for (const r of rows.filter(
            (x) => x.action === "rescinded" || x.action === "step_up",
          )) {
            try {
              reAuctions.push(await reAuction(String(r.deal_id)));
            } catch (e) {
              console.error("[offer-ratchet] re-auction failed", r.deal_id, e);
            }
          }

          return Response.json({
            ok: true,
            processed: rows.length,
            actions: rows,
            re_auctioned: reAuctions.length,
            re_auctions: reAuctions,
            at: new Date().toISOString(),
          });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
