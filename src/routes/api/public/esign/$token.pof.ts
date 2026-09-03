// Open-Banking Proof of Funds gate for a tokenized assignment agreement.
// GET  → current gate state
// POST { action: "link" }            → Plaid Link token
// POST { action: "verify", public_token } → live balance check + hard lock
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/esign/$token/pof")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { getPofState } = await import("@/lib/pof.server");
        const s = await getPofState(params.token ?? "");
        if (!s) return Response.json({ error: "not_found" }, { status: 404 });
        return Response.json(s, { headers: { "Cache-Control": "no-store" } });
      },
      POST: async ({ request, params }) => {
        let body: any = {};
        try {
          body = await request.json();
        } catch {}
        const token = params.token ?? "";
        if (body?.action === "verify") {
          const pt = typeof body?.public_token === "string" ? body.public_token : "";
          if (!pt) return Response.json({ error: "public_token_required" }, { status: 400 });
          const { verifyPof } = await import("@/lib/pof.server");
          const r = await verifyPof(token, pt);
          return Response.json(r, { status: r.ok ? 200 : 400 });
        }
        const { createBuyerLinkToken } = await import("@/lib/pof.server");
        const r = await createBuyerLinkToken(token, new URL(request.url).origin);
        return Response.json(r, { status: r.ok ? 200 : 400 });
      },
    },
  },
});
