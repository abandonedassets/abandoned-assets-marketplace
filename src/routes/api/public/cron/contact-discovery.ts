// Autonomous institutional contact discovery sweep (Tier 1-4).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/contact-discovery")({
  server: {
    handlers: {
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});

async function run(request: Request) {
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 10) || 10;
    const { runContactDiscoveryWorker } = await import("@/lib/contact-discovery.server");
    const report = await runContactDiscoveryWorker(limit);
    return Response.json({ ...report, at: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
