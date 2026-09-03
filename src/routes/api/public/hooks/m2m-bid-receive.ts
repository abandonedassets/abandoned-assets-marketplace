// POST /api/public/hooks/m2m-bid-receive — inbound algorithmic bid ingestion.
// Machines authenticate with their registered API key; accepted bids strike
// instantly with no dashboard approval.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "*",
};

const Body = z.object({
  buyer_api_key: z.string().min(16).max(200),
  asset_id: z.string().uuid(),
  bid_amount: z.number().positive().max(1_000_000_000),
  stripe_payment_intent: z.string().min(3).max(200),
  buyer_reference: z.string().max(160).optional().nullable(),
});

export const Route = createFileRoute("/api/public/hooks/m2m-bid-receive")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () =>
        new Response(
          JSON.stringify({
            schema: "m2m.bid/1.0",
            required: ["buyer_api_key", "asset_id", "bid_amount", "stripe_payment_intent"],
          }),
          { headers: CORS },
        ),
      POST: async ({ request }) => {
        try {
          const key = request.headers.get("x-api-key") ?? "";
          const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
          const json = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          if (!json["buyer_api_key"] && (key || bearer)) json["buyer_api_key"] = key || bearer;

          const parsed = Body.safeParse(json);
          if (!parsed.success) {
            return new Response(
              JSON.stringify({ ok: false, error: "invalid_payload", detail: parsed.error.issues }),
              { status: 400, headers: CORS },
            );
          }

          const { ingestAlgorithmicBid } = await import("@/lib/liquidity-router.server");
          const res = await ingestAlgorithmicBid(parsed.data);
          return new Response(JSON.stringify(res), { status: res.status ?? 200, headers: CORS });
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
            status: 500,
            headers: CORS,
          });
        }
      },
    },
  },
});
