// Public cron entry for the full diagnostic self-heal sweep.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/diagnostic-sweep")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to run diagnostic sweep" }),
      POST: async () => {
        try {
          const { runDiagnosticSweep } = await import("@/lib/self-heal.server");
          const report = await runDiagnosticSweep();
          return Response.json({ ok: true, report, at: new Date().toISOString() });
        } catch (e) {
          console.error("[diagnostic-sweep] failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
