// Watchdog heartbeat. Runs every 5 minutes via pg_cron.
// If cleared velocity is $0 while assets sit stuck in Scout/unverified past
// the 30-minute threshold, force-flush the batch into Webhook_Dispatched.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/watchdog")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to run watchdog" }),
      POST: async () => {
        try {
          const { clearedVelocityUsd, flushScoutQueue, drainOutbox } = await import(
            "@/lib/self-heal.server"
          );
          const velocity = await clearedVelocityUsd(1440);
          let flushed = 0;
          if (velocity <= 0) flushed = await flushScoutQueue(30, 250);
          const outbox = await drainOutbox(25);

          if (flushed > 0) {
            const { writeAuditLog } = await import("@/lib/webhook-verify.server");
            await writeAuditLog({
              event_type: "WATCHDOG_FLUSH",
              reason: `zero_velocity_flush:${flushed}`,
            });
          }

          return Response.json({
            ok: true,
            velocity_usd: velocity,
            flushed,
            outbox,
            at: new Date().toISOString(),
          });
        } catch (e) {
          console.error("[watchdog] failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
