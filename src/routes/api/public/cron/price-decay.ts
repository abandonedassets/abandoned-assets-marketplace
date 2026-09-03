// Dutch auction worker: decays stale assignment fees every run.
import { createFileRoute } from "@tanstack/react-router";

async function run(request: Request) {
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 200) || 200;
    const { runPriceDecay } = await import("@/lib/price-decay.server");
    const report = await runPriceDecay(limit);
    return Response.json(
      { ...report, at: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/public/cron/price-decay")({
  server: {
    handlers: {
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});
