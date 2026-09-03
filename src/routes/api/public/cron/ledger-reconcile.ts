// Hourly ledger reconciliation sweep (Stripe settled balance vs event ledger).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/ledger-reconcile")({
  server: {
    handlers: {
      GET: async () => run(),
      POST: async () => run(),
    },
  },
});

async function run() {
  try {
    const { runLedgerReconciliation } = await import("@/lib/ledger-reconcile.server");
    const report = await runLedgerReconciliation(24);
    return Response.json({ ...report, at: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
