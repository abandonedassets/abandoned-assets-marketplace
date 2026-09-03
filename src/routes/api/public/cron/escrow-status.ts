// 08:00 escrow status-request worker (jittered, circuit-broken, hash-verifying).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/escrow-status")({
  server: {
    handlers: {
      GET: async () => run(),
      POST: async () => run(),
    },
  },
});

async function run() {
  try {
    const { runEscrowStatusWorker, sweepClearedDealsIntoEscrow } = await import(
      "@/lib/escrow-orders.server"
    );
    const opened = await sweepClearedDealsIntoEscrow(20);
    const worker = await runEscrowStatusWorker();
    return Response.json({ ok: true, opened, worker, at: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
