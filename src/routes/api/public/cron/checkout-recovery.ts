// Stalled-deal payment recovery sweep. Run every 5 minutes.
// Fires the raw expiring payment link 15 minutes after checkout abandonment.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/checkout-recovery")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const origin = `${url.protocol}//${url.host}`;
          const { recoverAbandonedCheckouts } = await import("@/lib/assignment-fee.server");
          const result = await recoverAbandonedCheckouts(origin);
          return Response.json(
            { ok: true, ...result },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e) {
          console.error("[cron/checkout-recovery] failed", e);
          return Response.json({ ok: false, error: String((e as Error)?.message ?? e) });
        }
      },
    },
  },
});
