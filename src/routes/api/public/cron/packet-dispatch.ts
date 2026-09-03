// Institutional deal packet dispatch worker. Called by pg_cron / external scheduler.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/packet-dispatch")({
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
    const { runPacketDispatchWorker } = await import("@/lib/packet-dispatch.server");
    const report = await runPacketDispatchWorker(limit);
    return Response.json({ ...report, at: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
