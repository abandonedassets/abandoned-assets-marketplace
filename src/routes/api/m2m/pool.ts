// C2C flash capital pooling — retail machines commit micro-allocations.
// POST /api/m2m/pool  Authorization: Bearer <api key>  { deal_id, amount_usd }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const Body = z.object({
  deal_id: z.string().uuid(),
  amount_usd: z.number().positive().max(5_000_000),
  buyer_reference: z.string().max(120).optional(),
  stripe_payment_intent_id: z.string().max(120).optional(),
});

export const Route = createFileRoute("/api/m2m/pool")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () =>
        Response.json(
          {
            endpoint: "/api/m2m/pool",
            method: "POST",
            auth: "Authorization: Bearer <institutional_api_key>",
            body: { deal_id: "uuid", amount_usd: "number" },
          },
          { headers: CORS },
        ),
      POST: async ({ request }) => {
        try {
          const auth = request.headers.get("authorization") ?? "";
          const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
          if (!bearer) return Response.json({ error: "unauthorized" }, { status: 403, headers: CORS });

          const parsed = Body.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success)
            return Response.json({ error: "invalid_payload" }, { status: 400, headers: CORS });

          const { authorizeInstitutionalKey } = await import("@/lib/m2m.server");
          const keyAuth = await authorizeInstitutionalKey(bearer);
          if (!keyAuth.ok)
            return Response.json({ error: keyAuth.error }, { status: keyAuth.status, headers: CORS });

          const { commitPoolCapital } = await import("@/lib/m2m-clearing.server");
          const result = await commitPoolCapital({
            dealId: parsed.data.deal_id,
            apiKeyId: keyAuth.key.id,
            buyerReference: parsed.data.buyer_reference ?? keyAuth.key.label ?? null,
            amountUsd: parsed.data.amount_usd,
            paymentIntentId: parsed.data.stripe_payment_intent_id ?? null,
          });
          if (!result.ok)
            return Response.json(result, { status: result.status, headers: CORS });
          return Response.json(result, { headers: CORS });
        } catch (e) {
          console.error("[m2m] pool failed", e);
          return Response.json({ error: "pool_failed" }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
