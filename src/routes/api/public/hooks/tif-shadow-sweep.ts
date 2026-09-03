// Time-in-Force sweeper. Runs every minute via pg_cron. Any shadow-matched
// asset whose 60-second execution window lapsed is revoked from the buyer and
// degraded to the public deal tape (Scout).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/tif-shadow-sweep")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, note: "POST to run TIF sweep" }),
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("sweep_expired_tif");
          if (error) return Response.json({ ok: false, error: error.message }, { status: 200 });
          const rows = (data as unknown[]) ?? [];
          return Response.json({ ok: true, expired: rows.length, rows });
        } catch (e) {
          console.error("[tif-sweep] failed", e);
          return Response.json({ ok: false, error: "sweep_failed" }, { status: 200 });
        }
      },
    },
  },
});
