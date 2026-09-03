// Starts the mandatory $1,000 EMD micro-hold for a tokenized e-sign contract.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/esign/$token/emd")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { getEmdState } = await import("@/lib/emd.server");
        const s = await getEmdState(params.token ?? "");
        if (!s) return Response.json({ error: "not_found" }, { status: 404 });
        return Response.json(
          { status: s.emd_hold_status, amount: Number(s.emd_hold_amount ?? 1000) },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
      POST: async ({ request, params }) => {
        const origin = new URL(request.url).origin;
        const { createEmdHold } = await import("@/lib/emd.server");
        const r = await createEmdHold(params.token ?? "", origin);
        return Response.json(r, { status: r.ok ? 200 : 400 });
      },
    },
  },
});
