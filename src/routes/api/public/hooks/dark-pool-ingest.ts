// POST /api/public/hooks/dark-pool-ingest
// Reverse-demand ingestion: poll active buy boxes -> reverse-match inventory ->
// JIT skip-trace only pre-sold APNs -> emit tokenized seller authorization links.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/dark-pool-ingest")({
  server: {
    handlers: {
      GET: async () => run(10),
      POST: async ({ request }) => {
        let limit = 10;
        try {
          const body = (await request.json()) as { limit?: number };
          if (Number.isFinite(body?.limit)) limit = Math.max(1, Math.min(50, Number(body.limit)));
        } catch {
          /* default */
        }
        return run(limit);
      },
    },
  },
});

async function run(limit: number) {
  const started = Date.now();
  const { runDarkPoolIngest } = await import("@/lib/dark-pool.server");
  const res = await runDarkPoolIngest(limit);
  return Response.json({ ...res, ms: Date.now() - started });
}
