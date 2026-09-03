// Quantum decay: any deal sitting in EMD_PENDING for >24h releases the buyer
// hold, penalizes that buy box's priority score, and re-dispatches to the
// secondary eligible buy box. Fail-forward per record.
import { createFileRoute } from "@tanstack/react-router";
import { pickBox } from "./escrow-bind";

export const Route = createFileRoute("/api/public/hooks/emd-decay")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to run the 24h EMD decay sweep" }),
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();

          const { data: boxData } = await supabaseAdmin
            .from("buyer_buy_boxes")
            .select(
              "id,buyer_id,label,target_zip_codes,target_asset_types,max_contract_price,min_placement_margin,capital_to_deploy_usd,urgency_score",
            )
            .eq("active", true)
            .is("deprecated_at", null)
            .limit(200);
          const boxes = (boxData ?? []) as any[];

          const { data: stale } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select(
              "id,zip,asset_type,base_contract_price,optimized_acquisition_premium,matched_buy_box_id,escrow_pending_at",
            )
            .eq("escrow_status", "EMD_PENDING")
            .lt("escrow_pending_at", cutoff)
            .limit(300);

          let decayed = 0;
          let reassigned = 0;
          for (const a of (stale ?? []) as Array<Record<string, any>>) {
            try {
              const prior = a["matched_buy_box_id"] as string | null;
              if (prior) {
                const b = boxes.find((x) => x.id === prior);
                if (b) {
                  await supabaseAdmin
                    .from("buyer_buy_boxes")
                    .update({
                      urgency_score: Math.max(0, Number(b.urgency_score ?? 0) - 5),
                    } as never)
                    .eq("id", prior);
                  b.urgency_score = Math.max(0, Number(b.urgency_score ?? 0) - 5);
                }
              }

              const next = pickBox(
                boxes as never,
                {
                  zip: a["zip"],
                  asset_type: a["asset_type"],
                  price: Number(a["base_contract_price"] ?? 0),
                  fee: Number(a["optimized_acquisition_premium"] ?? 0),
                },
                prior,
              );

              await supabaseAdmin
                .from("closing_pipeline_items")
                .update(
                  next
                    ? {
                        matched_buyer_id: next.buyer_id,
                        matched_buy_box_id: next.id,
                        escrow_status: "EMD_PENDING",
                        escrow_pending_at: new Date().toISOString(),
                      }
                    : {
                        matched_buyer_id: null,
                        matched_buy_box_id: null,
                        escrow_status: null,
                        escrow_pending_at: null,
                      },
                )
                .eq("id", a["id"]);

              await supabaseAdmin
                .from("system_audit_logs")
                .insert({
                  pipeline_item_id: a["id"],
                  event_type: "EMD_DECAY_24H",
                  reason: next
                    ? `EMD unconfirmed in 24h — re-dispatched to ${next.label ?? next.id}`
                    : "EMD unconfirmed in 24h — hold released, no secondary buy box",
                  payload: { prior_box: prior, next_box: next?.id ?? null } as never,
                } as never)
                .then(undefined, () => {});

              decayed++;
              if (next) reassigned++;
            } catch (e) {
              console.error("[emd-decay] record failed", a["id"], e);
            }
          }
          return Response.json({ ok: true, decayed, reassigned });
        } catch (e) {
          console.error("[emd-decay] failed", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
        }
      },
    },
  },
});
