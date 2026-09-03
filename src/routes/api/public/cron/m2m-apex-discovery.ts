// Apex peering hunter: schema discovery, morphed handshakes, dead-node reaping.
import { createFileRoute } from "@tanstack/react-router";

async function run() {
  try {
    const { runApexDiscovery } = await import("@/lib/apex-discovery.server");
    const result = await runApexDiscovery();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
  }
}

export const Route = createFileRoute("/api/public/cron/m2m-apex-discovery")({
  server: { handlers: { GET: run, POST: run } },
});
