// Commercial taxonomy + institutional metrics sweep. Fail-forward: always 200.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/cre-enrich")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, hint: "POST { limit } to run the CRE enrichment sweep" }),
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as { limit?: number };
          const { runCreEnrichSweep } = await import("@/lib/cre-enrich.server");
          const result = await runCreEnrichSweep(Math.min(500, Number(body?.limit) || 250));
          return Response.json(result);
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
        }
      },
    },
  },
});
