// Binds dispatched assets to the highest-ranking eligible standing buy box and
// moves them into EMD_PENDING so the Settlement Terminal reflects locked escrow.
// Fail-forward: any per-asset error is skipped, the sweep continues.
import { createFileRoute } from "@tanstack/react-router";

type Box = {
  id: string;
  buyer_id: string;
  label: string | null;
  target_zip_codes: string[] | null;
  target_asset_types: string[] | null;
  max_contract_price: number | null;
  min_placement_margin: number | null;
  capital_to_deploy_usd: number | null;
  urgency_score: number | null;
};

export function pickBox(
  boxes: Box[],
  asset: { zip?: string | null; asset_type?: string | null; price: number; fee: number },
  exclude?: string | null,
): Box | null {
  const eligible = boxes.filter((b) => {
    if (exclude && b.id === exclude) return false;
    const zips = b.target_zip_codes ?? [];
    const types = b.target_asset_types ?? [];
    if (zips.length && (!asset.zip || !zips.includes(asset.zip))) return false;
    if (types.length && asset.asset_type && !types.includes(asset.asset_type)) return false;
    if (Number(b.max_contract_price ?? 0) > 0 && asset.price > Number(b.max_contract_price)) return false;
    const minFee = Number(b.min_placement_margin ?? 0);
    if (minFee >= 100 && asset.fee < minFee) return false; // dollar-denominated floor
    return true;
  });
  eligible.sort(
    (a, b) =>
      Number(b.urgency_score ?? 0) - Number(a.urgency_score ?? 0) ||
      Number(b.capital_to_deploy_usd ?? 0) - Number(a.capital_to_deploy_usd ?? 0),
  );
  return eligible[0] ?? null;
}

export const Route = createFileRoute("/api/public/hooks/escrow-bind")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to bind dispatched deals to escrow" }),
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: boxData } = await supabaseAdmin
            .from("buyer_buy_boxes")
            .select(
              "id,buyer_id,label,target_zip_codes,target_asset_types,max_contract_price,min_placement_margin,capital_to_deploy_usd,urgency_score",
            )
            .eq("active", true)
            .is("deprecated_at", null)
            .limit(200);
          const boxes = (boxData ?? []) as unknown as Box[];
          if (!boxes.length) return Response.json({ ok: true, bound: 0, reason: "no_active_boxes" });

          const { data: assets } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select("id,zip,asset_type,base_contract_price,optimized_acquisition_premium,escrow_status")
            .eq("status", "Webhook_Dispatched")
            .is("escrow_status", null)
            .limit(500);

          let bound = 0;
          for (const a of (assets ?? []) as Array<Record<string, any>>) {
            try {
              const hit = pickBox(boxes, {
                zip: a["zip"],
                asset_type: a["asset_type"],
                price: Number(a["base_contract_price"] ?? 0),
                fee: Number(a["optimized_acquisition_premium"] ?? 0),
              });
              if (!hit) continue;
              await supabaseAdmin
                .from("closing_pipeline_items")
                .update({
                  matched_buyer_id: hit.buyer_id,
                  matched_buy_box_id: hit.id,
                  escrow_status: "EMD_PENDING",
                  escrow_pending_at: new Date().toISOString(),
                } as never)
                .eq("id", a["id"]);
              // Mint the inbound FBO virtual account so the buyer's treasury
              // algorithm has a precise destination for its wire.
              try {
                const { ensureFboAccount } = await import("@/lib/fbo.server");
                await ensureFboAccount(a["id"], Number(a["optimized_acquisition_premium"] ?? 0) || null);
              } catch (e) {
                console.error("[escrow-bind] fbo mint failed", a["id"], e);
              }
              bound++;
            } catch (e) {

              console.error("[escrow-bind] asset failed", a["id"], e);
            }
          }
          return Response.json({ ok: true, bound, boxes: boxes.length });
        } catch (e) {
          console.error("[escrow-bind] failed", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
        }
      },
    },
  },
});
