// POST /api/public/v1/sandbox/execute — UAT-only execution endpoint.
// Sandbox keys are scope-locked to /sandbox/ paths. Zero-value dry run:
// signature + TIF + idempotency are production-identical, rails are never touched.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/sandbox/execute")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { M2M_CORS } = await import("@/lib/m2m-hmac.server");
        return new Response(null, { status: 204, headers: M2M_CORS });
      },
      POST: async ({ request }) => {
        const t0 = Date.now();
        const { verifySignedRequest, M2M_CORS } = await import("@/lib/m2m-hmac.server");
        const endpoint = new URL(request.url).pathname;

        const verified = await verifySignedRequest(request, { requireTxnId: true });
        if (!verified.ok) {
          return Response.json(
            { accepted: false, error: verified.error, detail: verified.detail ?? null },
            { status: verified.status, headers: M2M_CORS },
          );
        }
        if (!verified.key.sandbox) {
          return Response.json(
            { accepted: false, error: "production_scope_violation" },
            { status: 403, headers: M2M_CORS },
          );
        }

        const { TIF_SECONDS } = await import("@/lib/m2m-protocol.server");
        const submittedAt = Number(request.headers.get("x-m2m-timestamp")) || 0;
        if (Date.now() / 1000 - submittedAt > TIF_SECONDS) {
          return Response.json(
            { accepted: false, error: "tif_expired" },
            { status: 410, headers: M2M_CORS },
          );
        }

        const { executePull } = await import("@/lib/m2m-execute.server");
        const delayHeader = request.headers.get("x-mock-rail-delay-ms");
        const res = await executePull({
          key: verified.key,
          body: verified.body,
          txnId: verified.txnId as string,
          endpoint,
          dryRun: true,
          mockRailBase: process.env["MOCK_BANK_ORIGIN"] || new URL(request.url).origin,
          mockDelayMs: delayHeader != null ? Number(delayHeader) : null,
        });

        res.headers.set("X-Uat-Latency-Ms", String(Date.now() - t0));
        return res;
      },
    },
  },
});
