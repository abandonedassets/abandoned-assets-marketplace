// One-time / repeatable Scout flush. Scores every trapped Scout asset with the
// local confidence engine and promotes eligible rows (>=60) straight to
// Webhook_Dispatched against the active standing buy box.
// Fail-forward: one bad row never stops the sweep.
import { createFileRoute } from "@tanstack/react-router";
import { calculateLeadConfidence } from "@/lib/confidence";

export const Route = createFileRoute("/api/public/hooks/scout-flush")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to flush Scout assets" }),
      POST: async ({ request }) => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          let limit = 1000;
          try {
            const b: any = await request.json();
            if (Number(b?.limit) > 0) limit = Math.min(2000, Number(b.limit));
          } catch {}

          // Valve check: at least one active standing buy box must exist.
          const { data: boxes } = await supabaseAdmin
            .from("buyer_buy_boxes")
            .select("id")
            .eq("active", true)
            .is("deprecated_at", null)
            .limit(1);
          if (!boxes?.length) {
            return Response.json({ ok: false, error: "no_active_buy_box" }, { status: 200 });
          }

          const { data: rows } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select(
              "id, address, zip, base_contract_price, optimized_acquisition_premium, confidence_score",
            )
            .eq("status", "Scout")
            .limit(limit);

          let dispatched = 0;
          let held = 0;
          let failed = 0;

          for (const r of (rows ?? []) as any[]) {
            try {
              const local = calculateLeadConfidence({
                address: r.address,
                zip: r.zip,
                base_contract_price: r.base_contract_price,
              });
              const score = Math.max(Number(r.confidence_score ?? 0), local.score);
              if (score < 60) {
                held++;
                continue;
              }
              const { error } = await supabaseAdmin
                .from("closing_pipeline_items")
                .update({
                  confidence_score: score,
                  status: "Webhook_Dispatched",
                  manual_review: false,
                  is_held: false,
                  notification_queued: true,
                } as never)
                .eq("id", r.id);
              if (error) {
                failed++;
                continue;
              }
              dispatched++;

              // Pre-bound MPC buy boxes execute Sign 3 with zero latency.
              try {
                const { executePreBinding } = await import("@/lib/pre-binding.server");
                await executePreBinding({
                  id: r.id,
                  zip: r.zip,
                  asset_type: null,
                  base_contract_price: r.base_contract_price,
                  optimized_acquisition_premium: r.optimized_acquisition_premium,
                });
              } catch (e) {
                console.error("[scout-flush] pre-binding failed", e);
              }

              // Priority route to any matching shadow-liquidity algo.
              try {
                const { routeShadowLiquidity } = await import("@/lib/shadow-liquidity.server");
                await routeShadowLiquidity({
                  id: r.id,
                  zip: r.zip,
                  asset_type: null,
                  base_contract_price: r.base_contract_price,
                  optimized_acquisition_premium: r.optimized_acquisition_premium,
                });
              } catch (e) {
                console.error("[scout-flush] shadow route failed", e);
              }
            } catch (e) {
              failed++;
              console.error("[scout-flush] row failed", e);
            }
          }

          return Response.json({
            ok: true,
            scanned: rows?.length ?? 0,
            dispatched,
            held,
            failed,
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
