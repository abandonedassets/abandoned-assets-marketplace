// Autonomous self-healing sweep: releases orphaned locks, purges stuck leads,
// resets circuit-broken buyer endpoints, and parks exhausted DLQ rows.
import { createFileRoute } from "@tanstack/react-router";
import { withErrorLogging } from "@/lib/logger.server";

const ROUTE = "/api/public/cron/self-heal";

const run = withErrorLogging(ROUTE, async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin.rpc("self_heal_pipeline");
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{ action_taken: string; items_repaired: number }>;
  const pick = (label: string) =>
    Number(rows.find((r) => r.action_taken === label)?.items_repaired ?? 0);

  // Park permanently failed dead-letter events.
  let permanently_failed = 0;
  const { data: dead } = await supabaseAdmin
    .from("dlq_events")
    .update({ status: "PERMANENTLY_FAILED" })
    .eq("status", "PENDING")
    .is("resolved_at", null)
    .gt("attempts", 5)
    .select("id");
  permanently_failed = dead?.length ?? 0;

  return Response.json(
    {
      ok: true,
      repaired: {
        orphaned_locks_cleared: pick("Released Orphaned Expiry Locks"),
        stuck_leads_purged: pick("Purged Stuck Preflight Leads"),
        circuit_breakers_reset: pick("Reset Circuit-Broken Endpoints"),
        dlq_permanently_failed: permanently_failed,
      },
      at: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});

export const Route = createFileRoute("/api/public/cron/self-heal")({
  server: {
    handlers: {
      GET: async ({ request }) => run({ request }),
      POST: async ({ request }) => run({ request }),
    },
  },
});
