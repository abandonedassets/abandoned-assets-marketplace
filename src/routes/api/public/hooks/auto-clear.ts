// Zero-Touch Settlement Sweep — auto-clears any Locked-Escrow-Pending deal
// that has passed confidence + sanity gates. Fail-forward: a single stuck
// asset must never block the cohort. Runs every minute via pg_cron.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/auto-clear")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { data, error } = await supabaseAdmin.rpc(
            "auto_clear_eligible_deals" as any,
          );
          if (error) {
            console.error("[auto-clear] rpc failed", error);
            return Response.json({ ok: false, error: error.message }, { status: 200 });
          }
          const cleared = Array.isArray(data) ? data : [];
          // Fire-and-forget telemetry per cleared asset.
          if (cleared.length > 0) {
            try {
              const { notifyAdmin, fmtUsd } = await import("@/lib/notify.server");
              const total = cleared.reduce(
                (s: number, r: any) => s + Number(r.cleared_amount ?? 0),
                0,
              );
              await notifyAdmin(
                `⚡ AUTO-CLEAR: ${cleared.length} asset(s) settled · ${fmtUsd(total)} routed to payout`,
              );
            } catch (e) {
              console.error("[auto-clear] notify failed", e);
            }
          }
          return Response.json({
            ok: true,
            cleared_count: cleared.length,
            cleared,
            at: new Date().toISOString(),
          });
        } catch (e) {
          console.error("[auto-clear] unhandled", e);
          return Response.json(
            { ok: false, error: (e as Error).message },
            { status: 200 },
          );
        }
      },
      GET: async () =>
        Response.json({ ok: true, hint: "POST to run zero-touch sweep" }),
    },
  },
});
