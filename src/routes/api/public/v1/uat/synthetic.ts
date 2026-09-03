// POST /api/public/v1/uat/synthetic — internal synthetic UAT crucible runner.
// Gated by the INTERNAL_UAT_KEY server secret. Zero-value only: never touches
// the banking rail. Every path returns an explicit response.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/uat/synthetic")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const expected = process.env["INTERNAL_UAT_KEY"];
          if (!expected) return Response.json({ error: "not_configured" }, { status: 503 });
          const provided = request.headers.get("x-internal-uat-key") ?? "";
          if (provided.length !== expected.length || provided !== expected)
            return Response.json({ error: "forbidden" }, { status: 403 });

          const { runUatHandshake, INTERNAL_TENANT_ID } = await import(
            "@/lib/uat-enclave.server"
          );
          const origin = new URL(request.url).origin;
          const run = await runUatHandshake({
            origin,
            tenant: INTERNAL_TENANT_ID,
            zeroValue: true,
          });
          return Response.json({ tenant: INTERNAL_TENANT_ID, run }, { status: 200 });
        } catch (e) {
          console.error("[uat/synthetic] failed", e);
          return Response.json({ error: "run_failed" }, { status: 500 });
        }
      },
    },
  },
});
