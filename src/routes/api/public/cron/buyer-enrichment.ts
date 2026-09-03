// Autonomous buyer contact enrichment sweep (domain resolve + MX gate).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/buyer-enrichment")({
  server: {
    handlers: {
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});

async function run(request: Request) {
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 8) || 8;
    const { runBuyerEnrichment } = await import("@/lib/buyer-enrichment.server");
    const report = await runBuyerEnrichment(Math.min(limit, 25));
    return Response.json({ ...report, at: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
