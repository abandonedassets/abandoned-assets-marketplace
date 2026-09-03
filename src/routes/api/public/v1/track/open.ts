// Public headless telemetry sink. Email clients have no application session;
// the server-side admin client records the event without exposing credentials.
import { createFileRoute } from "@tanstack/react-router";

const PIXEL = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

export const Route = createFileRoute("/api/public/v1/track/open")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const contractId = url.searchParams.get("contract_id");
          const buyerId = url.searchParams.get("buyer_id");
          if (contractId) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { error } = await supabaseAdmin.from("offer_delivery_logs").insert({
              contract_id: contractId,
              buyer_id: buyerId || null,
              status: "OPENED",
              user_agent: request.headers.get("user-agent"),
              ip_address:
                request.headers.get("cf-connecting-ip") ||
                request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                null,
              meta: { occurred_at: new Date().toISOString(), source: "headless_email" },
            } as never);
            if (error) console.error("[public-track/open] insert failed", error.message);
          }
        } catch (error) {
          console.error("[public-track/open] failed", error);
        }
        return new Response(PIXEL, {
          status: 200,
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
        });
      },
    },
  },
});