// Observer: runs every 60 minutes via pg_cron. Marks any deal stuck >48h in
// New / Buyer-Signed / In-Escrow / Locked-Escrow-Pending as stale so the
// Deal Tape stays clean. Fail-forward — never blocks the pipeline.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/observer-sweep")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { data, error } = await supabaseAdmin.rpc(
            "observer_sweep_stale" as any,
          );
          if (error) {
            console.error("[observer-sweep] rpc failed", error);
            return Response.json(
              { ok: false, error: error.message },
              { status: 200 },
            );
          }
          const row = Array.isArray(data) ? data[0] : data;
          const marked = row?.marked_stale ?? 0;
          const busted = row?.busted_locks ?? 0;
          if (marked + busted > 0) {
            try {
              await supabaseAdmin.from("system_alerts" as any).insert({
                kind: "stale_sweep",
                severity: marked + busted > 5 ? "warn" : "info",
                message: `${marked} stale · ${busted} lock(s) busted`,
                metadata: { marked_stale: marked, busted_locks: busted },
              });
              const { notifyAdmin } = await import("@/lib/notify.server");
              await notifyAdmin(
                `⚠️ EXCEPTION: ${marked} asset(s) stale · ${busted} lock(s) busted`,
              );
            } catch (e) {
              console.error("[observer-sweep] alert log failed", e);
            }
          }
          return Response.json({
            ok: true,
            marked_stale: marked,
            busted_locks: busted,
            at: new Date().toISOString(),
          });

        } catch (e) {
          console.error("[observer-sweep] unhandled", e);
          return Response.json(
            { ok: false, error: (e as Error).message },
            { status: 200 },
          );
        }
      },
      GET: async () =>
        Response.json({ ok: true, hint: "POST to run observer sweep" }),
    },
  },
});
