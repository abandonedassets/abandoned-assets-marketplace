// Mid-flight reconciliation sweep (Webhook_Dispatched / WIRE_INSTRUCTIONS_SENT).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/midflight-reconcile")({
  server: {
    handlers: {
      GET: async () => run(),
      POST: async () => run(),
    },
  },
});

async function run() {
  try {
    const { runMidflightReconcile } = await import("@/lib/midflight-reconcile.server");
    const report = await runMidflightReconcile(200);
    return Response.json({ ...report, at: new Date().toISOString() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    );
  }
}
