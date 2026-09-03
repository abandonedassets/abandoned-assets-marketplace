// Headless VDR endpoint. Machine-readable due-diligence dossier, no auth wall,
// tokenized per asset. Institutional scrapers ingest this directly.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/vdr/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { resolveVdrToken, buildVdrPackage } = await import("@/lib/vdr.server");
          const dealId = await resolveVdrToken(params.token);
          if (!dealId) return Response.json({ error: "invalid_token" }, { status: 404 });
          const pkg = await buildVdrPackage(dealId);
          if (!pkg) return Response.json({ error: "not_found" }, { status: 404 });
          const { trackConversionAsync } = await import("@/lib/telemetry.server");
          trackConversionAsync({
            event: "VDR_OPENED",
            pipelineItemId: dealId,
            channel: "vdr",
            request,
          });
          return Response.json(pkg, {
            headers: {
              "Cache-Control": "public, max-age=300",
              "Access-Control-Allow-Origin": "*",
            },
          });
        } catch (e) {
          console.error("[vdr] failed", e);
          return Response.json({ error: "vdr_unavailable" }, { status: 200 });
        }
      },
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
          },
        }),
    },
  },
});
