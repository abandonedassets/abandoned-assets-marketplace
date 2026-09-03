// Meta-Evolution daemon entry point. Hourly pg_cron trigger.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/meta-evolution")({
  server: {
    handlers: {
      GET: async () => run(),
      POST: async () => run(),
    },
  },
});

async function run() {
  try {
    const { runSelfEvolutionCycle } = await import("@/lib/meta-evolution.server");
    return Response.json(await runSelfEvolutionCycle());
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
  }
}
