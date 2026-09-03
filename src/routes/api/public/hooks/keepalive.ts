// Persistent outbox drain + edge keep-alive. Runs every 5 minutes via pg_cron.
// Retries every parked payload until a 200 OK acknowledgment is received.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/keepalive")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, warm: true, at: new Date().toISOString() }),
      POST: async () => {
        try {
          const { drainOutbox } = await import("@/lib/self-heal.server");
          const result = await drainOutbox(100);
          return Response.json({ ok: true, ...result, at: new Date().toISOString() });
        } catch (e) {
          console.error("[keepalive] failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
