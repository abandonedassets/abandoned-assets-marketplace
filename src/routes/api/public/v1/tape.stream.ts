// GET /api/public/v1/tape/stream — outbound SSE feed of executable inventory.
// Funds subscribe here (HMAC signed GET) and execute via POST /api/public/v1/execute.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/tape/stream")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { M2M_CORS } = await import("@/lib/m2m-hmac.server");
        return new Response(null, { status: 204, headers: M2M_CORS });
      },
      GET: async ({ request }) => {
        const { verifySignedRequest, M2M_CORS } = await import("@/lib/m2m-hmac.server");
        const verified = await verifySignedRequest(request);
        if (!verified.ok)
          return Response.json(
            { error: verified.error, detail: verified.detail ?? null },
            { status: verified.status, headers: M2M_CORS },
          );

        const url = new URL(request.url);
        const intervalMs = Math.min(
          30_000,
          Math.max(2_000, Number(url.searchParams.get("interval_ms") ?? 5_000)),
        );
        const maxTicks = Math.min(600, Math.max(1, Number(url.searchParams.get("ticks") ?? 120)));

        const { streamTick } = await import("@/lib/m2m-tape.server");
        const encoder = new TextEncoder();
        let ticks = 0;
        let seen = new Set<string>();

        const stream = new ReadableStream({
          async start(controller) {
            const send = (event: string, data: unknown) =>
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
              );

            send("hello", {
              protocol: "AA-M2M/1",
              counterparty: verified.key.label,
              sandbox: verified.key.sandbox,
              execute_endpoint: "/api/public/v1/execute",
              signing: "HMAC-SHA256 over METHOD\\nPATH\\nTIMESTAMP\\nSHA256(body)",
              heartbeat_ms: intervalMs,
            });

            while (ticks < maxTicks) {
              const tickStart = Date.now();
              try {
                const rows = await streamTick();
                const fresh = rows.filter((r) => !seen.has(r.deal_id));
                if (seen.size > 4000) seen = new Set();
                for (const r of fresh) seen.add(r.deal_id);
                if (fresh.length) send("asset", { assets: fresh, count: fresh.length });

                // Bi-directional telemetry heartbeat: every tick carries a live
                // pulse of the venue so the counterparty's engine locks onto a
                // measured data stream, not a static row.
                const { assetPulse } = await import("@/lib/asset-pulse.server");
                send("pulse", await assetPulse(rows, Date.now() - tickStart));
              } catch (e) {
                send("error", { message: e instanceof Error ? e.message : String(e) });
              }

              ticks++;
              await new Promise((r) => setTimeout(r, intervalMs));
            }
            send("bye", { reason: "tick_limit" });
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            ...M2M_CORS,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
