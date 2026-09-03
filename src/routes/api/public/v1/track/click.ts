// Public click interceptor. Telemetry is fail-forward: logging can never block
// the buyer from reaching the execution portal.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/track/click")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const contractId = url.searchParams.get("contract_id");
        const buyerId = url.searchParams.get("buyer_id");
        try {
          if (contractId) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { error } = await supabaseAdmin.from("offer_delivery_logs").insert({
              contract_id: contractId,
              buyer_id: buyerId || null,
              status: "CLICKED",
              user_agent: request.headers.get("user-agent"),
              ip_address:
                request.headers.get("cf-connecting-ip") ||
                request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                null,
              meta: { occurred_at: new Date().toISOString(), source: "headless_email" },
            } as never);
            if (error) console.error("[public-track/click] insert failed", error.message);
          }
        } catch (error) {
          console.error("[public-track/click] failed", error);
        }

        const destination = contractId
          ? `/sign/${encodeURIComponent(contractId)}${buyerId ? `?buyer_id=${encodeURIComponent(buyerId)}` : ""}`
          : "/";
        return new Response(null, {
          status: 302,
          headers: { Location: destination, "Cache-Control": "no-store" },
        });
      },
    },
  },
});