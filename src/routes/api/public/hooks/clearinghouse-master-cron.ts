// POST /api/public/hooks/clearinghouse-master-cron
// Single 10-minute autonomous sequence: ARV -> reverse-strike -> exchange-match.
// Fail-forward: a failing step never blocks the next one.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/clearinghouse-master-cron")({
  server: {
    handlers: {
      GET: async () => run(),
      POST: async () => run(),
    },
  },
});

async function run() {
  const started = Date.now();
  const site = process.env["PUBLIC_SITE_URL"] ?? "https://asset-weaver-30.lovable.app";

  const call = async (path: string, body?: unknown) => {
    try {
      const res = await fetch(`${site}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      return (await res.json()) as Record<string, unknown>;
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  };

  const darkpool = await call("/api/public/hooks/dark-pool-ingest", { limit: 10 });
  const arv = await call("/api/public/hooks/calculate-real-arv", { limit: 50 });
  const strike = await call("/api/public/hooks/reverse-strike", { limit: 50 });
  const match = await call("/api/public/hooks/exchange-match");
  const flex = await call("/api/public/hooks/yield-flexion");
  const waterfall = await call("/api/public/hooks/wire-waterfall");
  void waterfall;


  let feesLocked = 0;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("optimized_acquisition_premium")
      .not("matched_buy_box_id", "is", null)
      .is("payout_at", null)
      .limit(1000);
    feesLocked = ((data ?? []) as Array<Record<string, any>>).reduce(
      (a, r) => a + Number(r["optimized_acquisition_premium"] ?? 0),
      0,
    );
  } catch {
    /* metrics are non-blocking */
  }

  return Response.json({
    ok: true,
    ms: Date.now() - started,
    darkpool_candidates: Number((darkpool as any)?.candidates ?? 0),
    darkpool_links: Number((darkpool as any)?.links_generated ?? 0),
    skip_traced: Number((darkpool as any)?.skip_traced ?? 0),
    arvs_calculated: Number((arv as any)?.scanned ?? 0),
    counters_sent: Number((strike as any)?.counters_sent ?? 0),
    "1031_matches_dispatched": Number((match as any)?.dispatched ?? 0),
    total_assignment_fees_locked: Math.round(feesLocked),
    assets_flexed: Number((flex as any)?.flexed ?? 0),
    assets_archived: Number((flex as any)?.archived ?? 0),
    steps: { darkpool, arv, strike, match, flex },
  });
}
