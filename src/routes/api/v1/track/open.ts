// Open-tracking pixel. GET /api/v1/track/open?contract_id=&buyer_id=
import { createFileRoute } from "@tanstack/react-router";

// 1x1 transparent PNG
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

export const Route = createFileRoute("/api/v1/track/open")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const contractId = url.searchParams.get("contract_id");
          const buyerId = url.searchParams.get("buyer_id");
          if (contractId) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            await supabaseAdmin.from("offer_delivery_logs").insert({
              contract_id: contractId,
              buyer_id: buyerId || null,
              status: "OPENED",
              user_agent: request.headers.get("user-agent"),
              ip_address:
                request.headers.get("cf-connecting-ip") ||
                request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                null,
            } as never);
          }
        } catch (e) {
          console.error("[track/open] failed", e);
        }
        return new Response(PNG, {
          status: 200,
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
