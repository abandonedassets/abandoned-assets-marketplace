// Autonomous buyer registry seeding sweep (live Indiana public records).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/registry-seed")({
  server: {
    handlers: {
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});

async function run(request: Request) {
  try {
    const raw = Number(new URL(request.url).searchParams.get("threshold") ?? 5);
    const threshold = Math.min(Math.max(Number.isFinite(raw) ? raw : 5, 1), 50);
    const { bootstrapLiveEcosystem } = await import("@/lib/registry-seed.server");
    const report = await bootstrapLiveEcosystem(threshold);
    return Response.json({ ...report, at: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
