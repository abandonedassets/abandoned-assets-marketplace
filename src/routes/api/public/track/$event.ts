// Outbound-link tracking beacon. Email/SMS/webhook links point here so every
// buyer touch is captured, then the buyer is redirected to the real target.
// Usage: /api/public/track/LINK_OPENED?d=<dealId>&e=<email>&u=<encoded target>
import { createFileRoute } from "@tanstack/react-router";

const PIXEL = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33,
  249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
]);

export const Route = createFileRoute("/api/public/track/$event")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const target = url.searchParams.get("u");
        try {
          const { trackConversion } = await import("@/lib/telemetry.server");
          await trackConversion({
            event: (params.event ?? "LINK_OPENED").toUpperCase() as never,
            pipelineItemId: url.searchParams.get("d"),
            buyerEmail: url.searchParams.get("e"),
            channel: url.searchParams.get("c") ?? "outbound_link",
            request,
            metadata: { target },
          });
        } catch (e) {
          console.error("[track] failed", e);
        }

        if (target && /^https?:\/\//i.test(target)) {
          return new Response(null, {
            status: 302,
            headers: { Location: target, "Cache-Control": "no-store" },
          });
        }
        return new Response(PIXEL, {
          headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
