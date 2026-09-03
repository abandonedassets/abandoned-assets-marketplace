// "Hanging wire" kill-switch. Run hourly.
// Stripe holds the assignment fee but the property wire never landed within
// 24h -> cancel the hold, revoke the lock, relist on the reverse-strike tape.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/wire-timeout-sweep")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { sweepHangingWires } = await import("@/lib/assignment-fee.server");
          const result = await sweepHangingWires();
          return Response.json(
            { ok: true, ...result },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e) {
          console.error("[cron/wire-timeout-sweep] failed", e);
          return Response.json({ ok: false, error: String((e as Error)?.message ?? e) });
        }
      },
    },
  },
});
