// Algorithmic waterfall worker: dispatch JSON payloads to M2M funds and
// revoke lapsed 60-second handshakes so the asset re-cascades instantly.
import { createFileRoute } from "@tanstack/react-router";

async function run() {
  const { dispatchM2MWaterfall, sweepM2MTimeouts } = await import("@/lib/m2m-algo.server");
  const sweep = await sweepM2MTimeouts();
  const dispatch = await dispatchM2MWaterfall().catch((e: Error) => ({
    ok: false,
    error: e.message,
  }));
  return Response.json({ ok: true, sweep, dispatch }, { headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/public/hooks/m2m-cycle")({
  server: { handlers: { GET: run, POST: run } },
});
