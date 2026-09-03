// POST /api/public/v1/fix — FIX 4.4 gateway (NewOrderSingle -> ExecutionReport).
// GET returns the executable tape as FIX SecurityDefinition messages.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/fix")({
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
            { error: verified.error },
            { status: verified.status, headers: M2M_CORS },
          );
        const { streamTick } = await import("@/lib/m2m-tape.server");
        const { tapeToFix } = await import("@/lib/fix-bridge.server");
        const assets = await streamTick(50);
        return new Response(tapeToFix(assets), {
          headers: { ...M2M_CORS, "Content-Type": "text/plain", "Cache-Control": "no-store" },
        });
      },
      POST: async ({ request }) => {
        const { verifySignedRequest, M2M_CORS } = await import("@/lib/m2m-hmac.server");
        const { fixToExecute, executeToFix } = await import("@/lib/fix-bridge.server");
        const endpoint = new URL(request.url).pathname;

        const verified = await verifySignedRequest(request);
        if (!verified.ok)
          return Response.json(
            { error: verified.error, detail: verified.detail ?? null },
            { status: verified.status, headers: M2M_CORS },
          );

        const order = fixToExecute(verified.body);
        if (!order.ok)
          return new Response(
            executeToFix(verified.txnId ?? "UNKNOWN", { error: order.error }, false),
            { status: 400, headers: { ...M2M_CORS, "Content-Type": "text/plain" } },
          );

        // ClOrdID (11) is the FIX-native idempotency key.
        const { executePull } = await import("@/lib/m2m-execute.server");
        const res = await executePull({
          key: verified.key,
          body: JSON.stringify(order.payload),
          txnId: order.clOrdId,
          endpoint,
        });
        const json = (await res.json().catch(() => ({}))) as Record<string, any>;
        return new Response(executeToFix(order.clOrdId, json, Boolean(json["accepted"])), {
          status: res.status,
          headers: { ...M2M_CORS, "Content-Type": "text/plain", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
