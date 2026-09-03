// POST /api/v1/deals/{id}/programmatic-lock
// Authorization: Bearer <institutional_api_key>
// Body: { payment_method_id, stripe_customer_id?, buyer_email?, buyer_reference? }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Payment-Method, X-Stripe-Customer",
};

const Body = z.object({
  payment_method_id: z.string().min(4).max(120).optional(),
  stripe_customer_id: z.string().min(4).max(120).optional(),
  buyer_email: z.string().email().max(200).optional(),
  buyer_reference: z.string().max(120).optional(),
});

export const Route = createFileRoute("/api/v1/deals/$id/programmatic-lock")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () =>
        Response.json(
          {
            endpoint: "/api/v1/deals/{id}/programmatic-lock",
            method: "POST",
            auth: "Authorization: Bearer <institutional_api_key>",
            body: ["payment_method_id", "stripe_customer_id?", "buyer_email?", "buyer_reference?"],
            emd_hold_usd: 1000,
          },
          { headers: CORS },
        ),
      POST: async ({ request, params }) => {
        try {
          const auth = request.headers.get("authorization") ?? "";
          const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
          if (!bearer)
            return Response.json({ error: "unauthorized" }, { status: 403, headers: CORS });

          let raw: unknown = {};
          try {
            raw = await request.json();
          } catch {
            raw = {};
          }
          const parsed = Body.safeParse(raw);
          if (!parsed.success)
            return Response.json({ error: "invalid_payload" }, { status: 400, headers: CORS });

          const paymentMethodId =
            request.headers.get("x-payment-method") ?? parsed.data.payment_method_id ?? "";
          const customerId =
            request.headers.get("x-stripe-customer") ?? parsed.data.stripe_customer_id ?? null;
          if (!paymentMethodId)
            return Response.json(
              { error: "missing_fields", required: ["payment_method_id"] },
              { status: 400, headers: CORS },
            );

          const { programmaticLock } = await import("@/lib/programmatic-lock.server");
          const result = await programmaticLock({
            bearer,
            dealId: params.id,
            paymentMethodId,
            stripeCustomerId: customerId,
            buyerEmail: parsed.data.buyer_email ?? null,
            buyerReference: parsed.data.buyer_reference ?? null,
          });

          if (!result.ok)
            return Response.json(
              { ok: false, error: result.error, detail: result.detail ?? null },
              { status: result.status, headers: CORS },
            );

          return Response.json(result, { headers: CORS });
        } catch (e) {
          console.error("[programmatic-lock] failed", e);
          return Response.json({ error: "lock_failed" }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
