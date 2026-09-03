// Pre-flight validation gateway worker.
import { createFileRoute } from "@tanstack/react-router";

async function run(request: Request) {
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 100) || 100;
    const { runPreflightSweep } = await import("@/lib/preflight-gate.server");
    const report = await runPreflightSweep(limit);
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

export const Route = createFileRoute("/api/public/cron/preflight-validate")({
  server: {
    handlers: {
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});
