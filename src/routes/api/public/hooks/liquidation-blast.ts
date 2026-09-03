// Autonomous liquidation valve: every 15 min, flips eligible assets to
// Webhook_Dispatched so Postgres triggers fire institutional payloads.
// Fail-forward — never blocks the pipeline.
import { createFileRoute } from "@tanstack/react-router";

const ELIGIBLE = ["House-Bid", "New", "Scout"] as const;

export const Route = createFileRoute("/api/public/hooks/liquidation-blast")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          const { data: rows, error: selErr } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select("id, status, optimized_acquisition_premium")
            .in("status", [...ELIGIBLE])
            .eq("is_stale", false)
            .eq("manual_review", false)
            .not("optimized_acquisition_premium", "is", null)
            .order("optimized_acquisition_premium", { ascending: false })
            .limit(100);
          if (selErr) throw selErr;

          const ids = (rows ?? []).map((r: { id: string }) => r.id);
          if (ids.length === 0) {
            return Response.json({ ok: true, dispatched: 0 });
          }

          const { error: updErr, count } = await supabaseAdmin
            .from("closing_pipeline_items")
            .update(
              { status: "Webhook_Dispatched", notification_queued: true } as never,
              { count: "exact" },
            )
            .in("id", ids);
          if (updErr) throw updErr;

          console.log(
            JSON.stringify({
              stage: "liquidation_blast",
              ts: new Date().toISOString(),
              dispatched: count ?? ids.length,
            }),
          );

          return Response.json({ ok: true, dispatched: count ?? ids.length });
        } catch (e) {
          console.error("[liquidation-blast] failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
