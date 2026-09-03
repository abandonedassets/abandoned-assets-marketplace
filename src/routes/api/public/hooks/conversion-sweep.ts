// Friction sweep: flags checkouts that opened but never cleared.
// A CHECKOUT_STARTED with no FUNDS_CLEARED after the grace window becomes an
// explicit CHECKOUT_ABANDONED event so the terminal shows where buyers drop.
import { createFileRoute } from "@tanstack/react-router";

const GRACE_HOURS = 24;

export const Route = createFileRoute("/api/public/hooks/conversion-sweep")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to sweep abandoned checkouts" }),
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const cutoff = new Date(Date.now() - GRACE_HOURS * 3_600_000).toISOString();

          const { data: started } = await supabaseAdmin
            .from("conversion_events" as never)
            .select("id, pipeline_item_id, buyer_email, created_at")
            .eq("event", "CHECKOUT_STARTED")
            .lte("created_at", cutoff)
            .limit(200);

          let flagged = 0;
          for (const raw of (started ?? []) as unknown as Array<Record<string, any>>) {
            try {
              if (!raw.pipeline_item_id) continue;

              const { data: deal } = await supabaseAdmin
                .from("closing_pipeline_items")
                .select("cleared_at")
                .eq("id", raw.pipeline_item_id)
                .maybeSingle();
              if ((deal as any)?.cleared_at) continue;

              const { data: already } = await supabaseAdmin
                .from("conversion_events" as never)
                .select("id")
                .eq("event", "CHECKOUT_ABANDONED")
                .eq("pipeline_item_id", raw.pipeline_item_id)
                .gte("created_at", raw.created_at)
                .limit(1);
              if ((already ?? []).length) continue;

              await supabaseAdmin.from("conversion_events" as never).insert({
                event: "CHECKOUT_ABANDONED",
                pipeline_item_id: raw.pipeline_item_id,
                buyer_email: raw.buyer_email ?? null,
                channel: "bluevine_ach",
                metadata: { started_at: raw.created_at, grace_hours: GRACE_HOURS },
              } as never);
              flagged++;
            } catch (e) {
              console.error("[conversion-sweep] row failed", e);
            }
          }

          return Response.json({ ok: true, flagged, at: new Date().toISOString() });
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
