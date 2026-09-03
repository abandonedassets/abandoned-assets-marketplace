// Local Edge Loopback Gateway.
// Terminal receiver for wire-instruction packets when a partner has no
// production endpoint yet. Always answers 2xx so the sweep never stalls.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/wire-loopback")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, gateway: "loopback", ready: true }),
      POST: async ({ request }) => {
        const { ipShieldCheck } = await import("@/lib/ip-shield.server");
        const blocked = ipShieldCheck(request);
        if (blocked) return blocked;
        let payload: any = null;
        try {
          payload = await request.json();
        } catch {
          /* tolerate empty/non-JSON bodies */
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin
            .from("system_audit_logs")
            .insert({
              pipeline_item_id: payload?.asset?.asset_id ?? null,
              event_type: "WIRE_LOOPBACK_RECEIVED",
              reason: `Loopback gateway accepted routing packet for ${payload?.asset?.asset_id ?? "unknown"}`,
              payload: payload as never,
            } as never);
        } catch (e) {
          console.error("[wire-loopback] log failed", e);
        }
        return Response.json({ ok: true, received: true, at: new Date().toISOString() });
      },
    },
  },
});
