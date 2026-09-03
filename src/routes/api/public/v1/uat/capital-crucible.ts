// POST /api/public/v1/uat/capital-crucible — runs the 402 gate / 500ms poison
// pill / atomic seal suite against the internal Mock RTGS service.
// Gated by INTERNAL_UAT_KEY. Zero fiat movement.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/uat/capital-crucible")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const expected = process.env["INTERNAL_UAT_KEY"];
          if (!expected) return Response.json({ error: "not_configured" }, { status: 503 });
          const provided = request.headers.get("x-internal-uat-key") ?? "";
          if (provided.length !== expected.length || provided !== expected)
            return Response.json({ error: "forbidden" }, { status: 403 });

          const body = (await request.json().catch(() => ({}))) as Record<string, any>;
          const { runCapitalCrucible } = await import("@/lib/capital-crucible.server");
          const run = await runCapitalCrucible({
            origin: new URL(request.url).origin,
            dealId: body["deal_id"] ?? null,
          });
          return Response.json(run, { status: 200 });
        } catch (e) {
          console.error("[uat/capital-crucible] failed", e);
          return Response.json({ error: "run_failed" }, { status: 500 });
        }
      },
    },
  },
});
