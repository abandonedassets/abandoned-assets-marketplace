// Background lead ingestor. Fans out to the existing zero-key harvest inlets
// (municipal GIS multiplex + county feeds) on a schedule so the pipeline
// self-feeds, then kicks the underwriter. Fail-forward: always 200.
import { createFileRoute } from "@tanstack/react-router";

const INLETS = [
  "/api/public/hooks/autonomous-gis-ingest",
  "/api/public/hooks/county-ingest",
];

export const Route = createFileRoute("/api/public/cron/ingest-leads")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to run the lead harvest" }),
      POST: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const results: Record<string, unknown>[] = [];

        for (const path of INLETS) {
          try {
            const res = await fetch(`${origin}${path}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
              signal: AbortSignal.timeout(110_000),
            });
            const json = await res.json().catch(() => ({}));
            results.push({ inlet: path, status: res.status, result: json });
          } catch (e) {
            results.push({ inlet: path, error: (e as Error).message });
          }
        }

        // Chain straight into underwriting so new rows never idle.
        let underwrite: unknown = null;
        try {
          const res = await fetch(`${origin}/api/public/cron/auto-underwrite`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ limit: 100 }),
            signal: AbortSignal.timeout(110_000),
          });
          underwrite = await res.json().catch(() => ({}));
        } catch (e) {
          underwrite = { error: (e as Error).message };
        }

        return Response.json({ ok: true, inlets: results, underwrite });
      },
    },
  },
});
