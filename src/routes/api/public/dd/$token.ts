// Instant DD dossier — tokenized per asset (same signing as the VDR).
// HTML by default (print-to-PDF ready), JSON with ?format=json.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/dd/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { resolveVdrToken } = await import("@/lib/vdr.server");
          const dealId = await resolveVdrToken(params.token);
          if (!dealId) return Response.json({ error: "invalid_token" }, { status: 404 });

          const { buildDdPacket, ddPacketHtml } = await import("@/lib/dd-packet.server");
          const pkt = await buildDdPacket(dealId);
          if (!pkt) return Response.json({ error: "not_found" }, { status: 404 });

          if (new URL(request.url).searchParams.get("format") === "json")
            return Response.json(pkt, { headers: { "cache-control": "no-store" } });

          return new Response(ddPacketHtml(pkt), {
            headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
          });
        } catch (e) {
          console.error("[dd-packet] failed", e);
          return Response.json({ error: (e as Error).message }, { status: 200 });
        }
      },
    },
  },
});
