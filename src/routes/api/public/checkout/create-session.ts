// POST { deal_id, rail? } →
//   rail "fee" (default): Stripe Checkout Session that AUTHORIZES the digital
//   contract assignment fee (manual capture — funds held, not moved).
//   rail "wire": legacy Bluevine settlement instruction for the property leg.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/checkout/create-session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          let body: any = {};
          try {
            body = await request.json();
          } catch {
            return Response.json({ error: "invalid_json" }, { status: 400 });
          }
          const dealId =
            typeof body?.deal_id === "string" ? body.deal_id.trim() : "";
          const rail =
            body?.rail === "wire" ? "wire" : body?.rail === "toll" ? "toll" : "fee";

          const url = new URL(request.url);
          const origin = `${url.protocol}//${url.host}`;
          const buyerEmail =
            typeof body?.buyer_email === "string" ? body.buyer_email : null;

          const result =
            rail === "wire"
              ? await (
                  await import("@/lib/checkout.server")
                ).mintOrReuseCheckoutSession(dealId, origin)
              : rail === "toll"
                ? await (
                    await import("@/lib/dual-rail.server")
                  ).createDataAccessToll(dealId, origin, {
                    buyerEmail,
                    buyerKeyId:
                      typeof body?.buyer_key_id === "string" ? body.buyer_key_id : null,
                  })
                : await (
                    await import("@/lib/assignment-fee.server")
                  ).createAssignmentFeeAuthorization(dealId, origin, { buyerEmail });


          if (!result.ok) {
            return Response.json(
              { error: result.error, detail: result.detail },
              { status: result.status },
            );
          }
          return Response.json({
            url: result.url,
            session_id: result.session_id,
            expires_at: result.expires_at,
            reused: result.reused,
          });
        } catch (e: any) {
          return Response.json(
            { error: "unhandled", detail: String(e?.message ?? e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
