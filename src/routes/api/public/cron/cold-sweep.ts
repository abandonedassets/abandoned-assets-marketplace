// Autonomous cold-storage treasury sweep. Called by pg_cron / external scheduler.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/cold-sweep")({
  server: {
    handlers: {
      GET: async () => run(),
      POST: async () => run(),
    },
  },
});

async function run() {
  try {
    const { runColdStorageSweep } = await import("@/lib/rtgs.server");
    const report = await runColdStorageSweep();
    return Response.json({ ...report, at: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
