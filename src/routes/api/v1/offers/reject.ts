// POST /api/v1/offers/reject — M2M structured rejection from fund buy-box algorithms.
// Body: { deal_id, reason_code, target_price?, note? }
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const CODES = [
  "YIELD_BELOW_HURDLE",
  "LIEN_THRESHOLD_EXCEEDED",
  "GEO_OUT_OF_BOUNDS",
  "EMD_RAIL_MISMATCH",
  "CAPITAL_SATURATED",
  "CUSTOM_OTHER",
];

export const Route = createFileRoute("/api/v1/offers/reject")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          const auth = request.headers.get("authorization") ?? "";
          const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
          if (!bearer) return Response.json({ error: "unauthorized" }, { status: 403, headers: CORS });

          const { authorizeInstitutionalKey } = await import("@/lib/m2m.server");
          const authed = await authorizeInstitutionalKey(bearer);
          if (!authed.ok)
            return Response.json({ error: authed.error }, { status: authed.status, headers: CORS });

          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const dealId = String(body['deal_id'] ?? "");
          const code = String(body['reason_code'] ?? "").toUpperCase();
          if (!dealId || !CODES.includes(code))
            return Response.json(
              { error: "deal_id and valid reason_code required", valid_codes: CODES },
              { status: 400, headers: CORS },
            );

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("reject_offer" as never, {
            _id: dealId,
            _code: code,
            _target_price: body['target_price'] != null ? Number(body['target_price']) : null,
            _note: (body['note'] as string) ?? null,
            _source: "api",
            _ip: request.headers.get("cf-connecting-ip"),
            _user_agent: request.headers.get("user-agent"),
          } as never);
          if (error) return Response.json({ error: error.message }, { status: 400, headers: CORS });

          return Response.json({ ok: true, ...(data as object) }, { headers: CORS });
        } catch (e) {
          console.error("[offers/reject] failed", e);
          return Response.json({ error: "unhandled" }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
