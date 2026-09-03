// Bluevine ACH debit request for a deal → hosted invoice URL bound to the row.
// GET redirects to the invoice; POST returns JSON.

import { createFileRoute } from "@tanstack/react-router";

async function mint(dealId: string, email: string | null) {
  const { createAchInvoice } = await import("@/lib/bluevine.server");
  return createAchInvoice(dealId.trim(), email);
}

export const Route = createFileRoute("/api/public/invoice/$dealId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const email = url.searchParams.get("email");
        const { trackConversionAsync } = await import("@/lib/telemetry.server");
        trackConversionAsync({
          event: "INVOICE_OPENED",
          pipelineItemId: params.dealId ?? null,
          buyerEmail: email,
          channel: "invoice_link",
          request,
        });
        const r = await mint(params.dealId ?? "", email);
        if (!r.ok)
          return Response.json({ error: r.error, detail: r.detail }, { status: r.status });
        trackConversionAsync({
          event: "CHECKOUT_STARTED",
          pipelineItemId: params.dealId ?? null,
          buyerEmail: email,
          channel: "stripe_ach",
          request,
        });
        return new Response(null, {
          status: 302,
          headers: { Location: r.url, "Cache-Control": "no-store" },
        });
      },

      POST: async ({ request, params }) => {
        let body: any = {};
        try {
          body = await request.json();
        } catch {}
        const r = await mint(
          params.dealId ?? "",
          typeof body?.email === "string" ? body.email : null,
        );
        if (!r.ok)
          return Response.json({ error: r.error, detail: r.detail }, { status: r.status });
        return Response.json(r);
      },
    },
  },
});
