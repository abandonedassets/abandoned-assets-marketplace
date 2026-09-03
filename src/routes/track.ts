// Zero-dependency click tracker. Every buyer-facing link routes through here
// so opens are recorded before the buyer is forwarded to the real target.
// /track?buyer=<id>&asset=<id>&target=<url>
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/track")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = url.searchParams.get("target");
        const asset = url.searchParams.get("asset");
        const buyer = url.searchParams.get("buyer");

        try {
          const { trackConversion } = await import("@/lib/telemetry.server");
          await trackConversion({
            event: "LINK_OPENED",
            pipelineItemId: asset,
            buyerEmail: buyer && buyer.includes("@") ? buyer : null,
            channel: "tracked_link",
            request,
            metadata: { buyer, target },
          });
        } catch (e) {
          console.error("[track] log failed", e);
        }

        // Fail-forward: always forward the buyer, even if logging failed.
        if (target && /^https?:\/\//i.test(target)) {
          return new Response(null, {
            status: 302,
            headers: { Location: target, "Cache-Control": "no-store" },
          });
        }
        return new Response(null, {
          status: 302,
          headers: { Location: "/", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
