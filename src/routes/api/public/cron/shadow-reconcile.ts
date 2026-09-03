// Out-of-band shadow reconciliation sweep. Called by pg_cron / external scheduler.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/shadow-reconcile")({
  server: {
    handlers: {
      GET: async () => run(),
      POST: async () => run(),
    },
  },
});

async function run() {
  try {
    const { runShadowReconciler } = await import("@/lib/shadow-reconciler.server");
    const report = await runShadowReconciler();
    return Response.json({ ok: true, ...report, at: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
