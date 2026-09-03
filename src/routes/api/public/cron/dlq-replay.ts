// Dead-letter replay worker for failed buyer dispatches.
import { createFileRoute } from "@tanstack/react-router";

async function run(request: Request) {
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 25) || 25;
    const { retryDlq } = await import("@/lib/dlq.server");
    const report = await retryDlq(limit);
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

export const Route = createFileRoute("/api/public/cron/dlq-replay")({
  server: {
    handlers: {
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});
