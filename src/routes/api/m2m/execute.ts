// Headless algorithmic execution endpoint for institutional buyers.
// POST with Authorization: Bearer <institutional_api_key>
// Headers or body: X-VDR-Access, X-Signature-Hash, X-Stripe-Customer
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-VDR-Access, X-Signature-Hash, X-Stripe-Customer",
};

const Body = z.object({
  vdr_token: z.string().min(20).max(200).optional(),
  signature_hash: z.string().min(16).max(200).optional(),
  stripe_customer_id: z.string().min(4).max(120).optional(),
  buyer_reference: z.string().max(120).optional(),
});

export const Route = createFileRoute("/api/m2m/execute")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () =>
        Response.json(
          {
            endpoint: "/api/m2m/execute",
            method: "POST",
            auth: "Authorization: Bearer <institutional_api_key>",
            required: ["X-VDR-Access", "X-Signature-Hash", "X-Stripe-Customer"],
            tif_window_ms: 60000,
          },
          { headers: CORS },
        ),
      POST: async ({ request }) => {
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

          const vdrToken = request.headers.get("x-vdr-access") ?? parsed.data.vdr_token ?? "";
          const signatureHash =
            request.headers.get("x-signature-hash") ?? parsed.data.signature_hash ?? "";
          const stripeCustomerId =
            request.headers.get("x-stripe-customer") ?? parsed.data.stripe_customer_id ?? "";

          if (!vdrToken || !signatureHash || !stripeCustomerId)
            return Response.json(
              {
                error: "missing_fields",
                required: ["X-VDR-Access", "X-Signature-Hash", "X-Stripe-Customer"],
              },
              { status: 400, headers: CORS },
            );

          const { executeM2M } = await import("@/lib/m2m.server");
          const result = await executeM2M({
            bearer,
            vdrToken,
            signatureHash,
            stripeCustomerId,
            buyerReference: parsed.data.buyer_reference ?? null,
          });

          if (!result.ok)
            return Response.json(
              { ok: false, error: result.error, detail: result.detail ?? null },
              { status: result.status, headers: CORS },
            );

          return Response.json(result, { headers: CORS });
        } catch (e) {
          console.error("[m2m] execute failed", e);
          return Response.json({ error: "execution_failed" }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
