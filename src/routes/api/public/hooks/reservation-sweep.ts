// Reservation sweeper. Any 15-minute exclusive lock that lapsed without a
// signed assignment is revoked, the buyer is penalized, and the asset is
// re-cascaded to the next fund in the waterfall.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/reservation-sweep")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, note: "POST to run reservation sweep" }),
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("sweep_expired_reservations" as never);
          if (error) return Response.json({ ok: false, error: error.message });
          const rows = (data as unknown[]) ?? [];
          return Response.json({ ok: true, revoked: rows.length, rows });
        } catch (e) {
          console.error("[reservation-sweep] failed", e);
          return Response.json({ ok: false, error: "sweep_failed" });
        }
      },
    },
  },
});
