import { createFileRoute } from "@tanstack/react-router";

// "Casino Dealer" rhythm endpoint. Invoked by pg_cron at a steady cadence.
// For pipeline items that have been sitting >30 days without resolution,
// re-stamp updated_at so the institutional tape re-presents them as a
// freshly minted, premium opportunity — no price changes, ever.
const REFRESH_AGE_DAYS = 30;
const ACTIVE_STATUSES = [
  "New",
  "Under-Review",
  "Seller-Signed",
  "Buyer-Signed",
  "In-Escrow",
] as const;

export const Route = createFileRoute("/api/public/hooks/asset-refresh")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const cutoff = new Date(
          Date.now() - REFRESH_AGE_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();
        const nowIso = new Date().toISOString();

        try {
          const { data, error } = await supabaseAdmin
            .from("closing_pipeline_items")
            .update({ updated_at: nowIso })
            .lt("updated_at", cutoff)
            .in("status", ACTIVE_STATUSES)
            .select("id");

          if (error) {
            console.error("asset-refresh update failed", error);
            return Response.json(
              { ok: false, error: error.message },
              { status: 200 }, // fail-forward: never stall the cron
            );
          }

          return Response.json({
            ok: true,
            refreshed: data?.length ?? 0,
            cadence: "calm",
            refreshed_at: nowIso,
          });
        } catch (e) {
          console.error("asset-refresh exception", e);
          return Response.json({ ok: false }, { status: 200 });
        }
      },
    },
  },
});
