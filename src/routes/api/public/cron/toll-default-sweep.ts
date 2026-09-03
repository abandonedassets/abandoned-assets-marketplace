// Reputation enforcement: burn nodes that harvested coordinates via the
// micro-toll and never funded the Bluevine assignment balance.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/toll-default-sweep")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { sweepTollDefaults } = await import("@/lib/dual-rail.server");
          const res = await sweepTollDefaults(24);
          return Response.json({ ok: true, ...res });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
      POST: async () => {
        const { sweepTollDefaults } = await import("@/lib/dual-rail.server");
        return Response.json({ ok: true, ...(await sweepTollDefaults(24)) });
      },
    },
  },
});
