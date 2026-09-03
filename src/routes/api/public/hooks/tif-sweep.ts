import { createFileRoute } from "@tanstack/react-router";

// 24h Time-In-Force auto-bust sweep. Called every 5 minutes by pg_cron.
// Any lock past lock_expires_at is reverted to Buyer-Signed and the
// dispatching endpoint's bust_count is incremented (lowering its score).
export const Route = createFileRoute("/api/public/hooks/tif-sweep")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { data, error } = await supabaseAdmin.rpc(
          "tif_sweep_expired_locks",
        );
        if (error) {
          return Response.json(
            { ok: false, error: error.message },
            { status: 500 },
          );
        }
        // Poison pill: cross-collateral lien on every non-performing buyer.
        let pills: unknown = { triggered: 0 };
        try {
          const { triggerPoisonPills } = await import("@/lib/poison-pill.server");
          const ids = ((data ?? []) as { deal_id?: string }[])
            .map((r) => r.deal_id)
            .filter(Boolean) as string[];
          pills = await triggerPoisonPills(ids);
        } catch {
          /* fail-forward */
        }
        return Response.json({
          ok: true,
          busted: Array.isArray(data) ? data.length : 0,
          poison_pills: pills,
          rows: data ?? [],
        });

      },
      GET: async () =>
        Response.json({ ok: true, note: "POST to run sweep" }),
    },
  },
});
