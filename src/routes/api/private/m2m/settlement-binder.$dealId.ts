// GET /api/private/m2m/settlement-binder/:dealId
// Verified-machine-only 3-pillar cryptographic settlement binder.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/private/m2m/settlement-binder/$dealId")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { BINDER_CORS } = await import("@/lib/settlement-binder.server");
        return new Response(null, { status: 204, headers: BINDER_CORS });
      },
      GET: async ({ request, params }) => {
        const { authorizeBinderCaller, buildSettlementBinder, BINDER_CORS } = await import(
          "@/lib/settlement-binder.server"
        );
        try {
          const auth = await authorizeBinderCaller(request);
          if (!auth.ok)
            return Response.json(
              { ok: false, error: auth.error, detail: (auth as any).detail ?? null },
              { status: auth.status, headers: BINDER_CORS },
            );

          const built = await buildSettlementBinder(params.dealId, auth.box.id);
          if (!built.ok)
            return Response.json(
              { ok: false, error: built.error, detail: (built as any).detail ?? null },
              { status: built.status, headers: BINDER_CORS },
            );

          return Response.json(built.binder, {
            headers: { ...BINDER_CORS, "Cache-Control": "no-store" },
          });
        } catch (e) {
          return Response.json(
            { ok: false, error: "binder_failed", detail: (e as Error).message },
            { status: 500, headers: BINDER_CORS },
          );
        }
      },
    },
  },
});
