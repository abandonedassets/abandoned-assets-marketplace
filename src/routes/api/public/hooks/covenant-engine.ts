// POST/GET /api/public/hooks/covenant-engine
// Autonomous risk desk + closing loop:
//  1. Dynamic haircut / borrowing-base recompute, DSCR + utilization covenants.
//  2. Auto-settlement of cleared deals to the Bluevine payout rail.
// Fail-forward: no single deal failure stalls the sweep.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/covenant-engine")({
  server: {
    handlers: {
      GET: async () => run(),
      POST: async () => run(),
    },
  },
});

async function run() {
  const started = Date.now();
  let covenant: unknown = null;
  const settled: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  try {
    const { runCovenantEngine } = await import("@/lib/covenant.server");
    covenant = await runCovenantEngine();
  } catch (e) {
    covenant = { ok: false, error: (e as Error).message };
  }

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { payoutAssignmentFee } = await import("@/lib/payout.server");
    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id")
      .not("cleared_at", "is", null)
      .is("payout_transfer_id", null)
      .limit(50);

    for (const row of ((data ?? []) as Array<{ id: string }>)) {
      try {
        const res = await payoutAssignmentFee(row.id);
        if (res.ok) settled.push(row.id);
        else skipped.push({ id: row.id, reason: res.reason });
      } catch (e) {
        skipped.push({ id: row.id, reason: (e as Error).message });
      }
    }
  } catch (e) {
    skipped.push({ id: "sweep", reason: (e as Error).message });
  }

  return Response.json({
    ok: true,
    ms: Date.now() - started,
    covenant,
    settlements_executed: settled.length,
    settled,
    skipped,
  });
}
