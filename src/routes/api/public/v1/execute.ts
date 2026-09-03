// POST /api/public/v1/execute — inbound institutional execution.
// HMAC-SHA256 signed, X-Client-Txn-Id mandatory, fully idempotent.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/execute")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { M2M_CORS } = await import("@/lib/m2m-hmac.server");
        return new Response(null, { status: 204, headers: M2M_CORS });
      },
      POST: async ({ request }) => {
        const t0 = Date.now();
        const { verifySignedRequest, M2M_CORS } = await import("@/lib/m2m-hmac.server");
        const { logInbound } = await import("@/lib/m2m-algo.server");
        const endpoint = new URL(request.url).pathname;

        const cloned = request.clone();
        const verified = await verifySignedRequest(request, { requireTxnId: true });
        if (!verified.ok) {
    if (verified.status >= 400) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("system_audit_logs").insert({
          event_type: "M2M_AUTH_ANOMALY",
          reason: `Auth failed for key prefix ${request.headers.get("x-m2m-key-id")}: ${verified.error}`,
          payload: { status: verified.status, ip: request.headers.get("cf-connecting-ip") } as any
        } as never);
      } catch {}
    }
          await logInbound({
            request: cloned,
            endpoint,
            key: request.headers.get("x-m2m-key-id") ?? undefined,
            status: verified.status,
            latencyMs: Date.now() - t0,
            bodyPreview: await cloned.text().catch(() => ""),
          });
          return Response.json(
            { accepted: false, error: verified.error, detail: verified.detail ?? null },
            { status: verified.status, headers: M2M_CORS },
          );
        }

        const { TIF_SECONDS } = await import("@/lib/m2m-protocol.server");
        const body = JSON.parse(verified.body);
        const submittedAt = Number(request.headers.get("x-m2m-timestamp")) || 0;
        const age = (Date.now() / 1000) - submittedAt;
        if (age > TIF_SECONDS) {
          return Response.json({ accepted: false, error: "tif_expired" }, { status: 410, headers: M2M_CORS });
        }
        const { executePull } = await import("@/lib/m2m-execute.server");
        const res = await executePull({
          key: verified.key,
          body: verified.body,
          txnId: verified.txnId as string,
          endpoint,
        });

        await logInbound({
          request: cloned,
          endpoint,
          key: verified.key.label ?? undefined,
          authorized: true,
          boxLabel: verified.key.label,
          status: res.status,
          latencyMs: Date.now() - t0,
          bodyPreview: verified.body,
        });
        return res;
      },
    },
  },
});
