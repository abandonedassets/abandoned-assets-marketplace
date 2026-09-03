import { createFileRoute } from "@tanstack/react-router";

// Pass I — Self-Cleaning Buyer Matrix.
// Deprecates auto-generated buyer_buy_boxes whose 90-day window expired
// without ever clearing an asset. Driven by SQL helper deprecate_stale_buy_boxes().

export const Route = createFileRoute("/api/public/hooks/buyer-matrix-sweep")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, note: "POST to sweep buyer matrix" }),
      POST: async () => {
        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { data, error } = await supabaseAdmin.rpc(
            "deprecate_stale_buy_boxes" as any,
          );
          if (error) {
            await supabaseAdmin.from("dead_letter_queue").insert({
              raw_payload: { op: "buyer_matrix_sweep" } as any,
              source_ip: "cron",
              error_reason: `buyer_sweep_failed: ${error.message}`,
            });
            return Response.json({ ok: false, error: error.message }, { status: 200 });
          }
          return Response.json({
            ok: true,
            deprecated: data ?? 0,
            ran_at: new Date().toISOString(),
          });
        } catch (e) {
          return Response.json(
            { ok: false, error: (e as Error).message },
            { status: 200 },
          );
        }
      },
    },
  },
});
