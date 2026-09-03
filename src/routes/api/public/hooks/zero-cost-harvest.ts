// Zero-Cost Arbitrage Protocol harvester.
//   1. SEC EDGAR (Form D / 8-K) -> institutional + 1031 liquidity leads
//   2. Municipal ArcGIS multiplex -> parcel/zoning inventory (existing inlet)
//   3. Weekly public-records (FOIA) requests -> builder permit CSVs
// Fail-forward: every stage is isolated; always returns 200.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/zero-cost-harvest")({
  server: {
    handlers: {
      GET: async () => run(new URL("http://localhost").origin, false),
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { force?: boolean };
        return run(new URL(request.url).origin, body?.force === true);
      },
    },
  },
});

async function run(origin: string, force: boolean) {
  const out: Record<string, unknown> = { ok: true };

  try {
    const { runEdgarHarvest } = await import("@/lib/edgar.server");
    out["edgar"] = await runEdgarHarvest(60);
  } catch (e) {
    out["edgar"] = { ok: false, error: (e as Error).message };
  }

  try {
    const res = await fetch(`${origin}/api/public/hooks/autonomous-gis-ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(110_000),
    });
    out["arcgis"] = await res.json().catch(() => ({ status: res.status }));
  } catch (e) {
    out["arcgis"] = { ok: false, error: (e as Error).message };
  }

  try {
    const { runFoiaSweep } = await import("@/lib/foia.server");
    out["foia"] = await runFoiaSweep(force);
  } catch (e) {
    out["foia"] = { ok: false, error: (e as Error).message };
  }

  return Response.json(out);
}
