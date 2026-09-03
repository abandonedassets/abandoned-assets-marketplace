// Mints inbound FBO virtual accounts for every asset awaiting buyer funds.
// Fail-forward: per-asset errors are logged inside the engine, sweep continues.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/fbo-provision")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to mint inbound FBO accounts" }),
      POST: async () => {
        try {
          const { provisionOpenDeals } = await import("@/lib/fbo.server");
          const r = await provisionOpenDeals();
          return Response.json({ ok: true, ...r });
        } catch (e) {
          console.error("[fbo-provision] failed", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
        }
      },
    },
  },
});
