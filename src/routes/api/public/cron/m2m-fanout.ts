// GET/POST /api/public/cron/m2m-fanout — blast REVERSE_STRIKE_READY assets to
// every registered institutional Buy-Box endpoint.
import { createFileRoute } from "@tanstack/react-router";

async function run(limit: number) {
  try {
    const { fanOutReadyAssets } = await import("@/lib/liquidity-router.server");
    return Response.json(await fanOutReadyAssets(limit));
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/cron/m2m-fanout")({
  server: {
    handlers: {
      GET: async () => run(25),
      POST: async ({ request }) => {
        let limit = 25;
        try {
          const b = (await request.json()) as { limit?: number };
          limit = Math.min(Math.max(Number(b?.limit ?? 25), 1), 100);
        } catch {
          /* empty body */
        }
        return run(limit);
      },
    },
  },
});
