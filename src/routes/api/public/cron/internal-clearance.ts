// Internal clearance sweep: title validation, internal escrow custody, and
// internally-issued settlement references. Safe to call repeatedly (idempotent).
import { createFileRoute } from "@tanstack/react-router";

async function run(limit: number) {
  try {
    const { runInternalClearance } = await import("@/lib/internal-clearance.server");
    const report = await runInternalClearance(limit);
    return Response.json({ ok: true, ...report, at: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    );
  }
}

export const Route = createFileRoute("/api/public/cron/internal-clearance")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        run(Number(new URL(request.url).searchParams.get("limit") ?? 500)),
      POST: async ({ request }) =>
        run(Number(new URL(request.url).searchParams.get("limit") ?? 500)),
    },
  },
});
