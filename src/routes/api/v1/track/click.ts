// Click interceptor. GET /api/v1/track/click?contract_id=&buyer_id=
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/track/click")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const contractId = url.searchParams.get("contract_id");
        const buyerId = url.searchParams.get("buyer_id");
        try {
          if (contractId) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            await supabaseAdmin.from("offer_delivery_logs").insert({
              contract_id: contractId,
              buyer_id: buyerId || null,
              status: "CLICKED",
              user_agent: request.headers.get("user-agent"),
              ip_address:
                request.headers.get("cf-connecting-ip") ||
                request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                null,
            } as never);
          }
        } catch (e) {
          console.error("[track/click] failed", e);
        }
        const dest = contractId
          ? `/sign/${contractId}${buyerId ? `?buyer_id=${encodeURIComponent(buyerId)}` : ""}`
          : "/";
        return new Response(null, {
          status: 302,
          headers: { Location: dest, "Cache-Control": "no-store" },
        });
      },
    },
  },
});
