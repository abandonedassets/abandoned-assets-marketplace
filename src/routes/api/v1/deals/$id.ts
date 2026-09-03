// GET /api/v1/deals/{id} — Institutional Deal Deck (underwriting payload).
// Authorization: Bearer <institutional_api_key>
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export const Route = createFileRoute("/api/v1/deals/$id")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request, params }) => {
        try {
          const auth = request.headers.get("authorization") ?? "";
          const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
          if (!bearer)
            return Response.json({ error: "unauthorized" }, { status: 403, headers: CORS });

          const { authorizeInstitutionalKey } = await import("@/lib/m2m.server");
          const ok = await authorizeInstitutionalKey(bearer);
          if (!ok.ok)
            return Response.json({ error: ok.error }, { status: ok.status, headers: CORS });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select("*")
            .eq("id", params.id)
            .maybeSingle();
          if (!data) return Response.json({ error: "deal_not_found" }, { status: 404, headers: CORS });

          const { buildDealDeck } = await import("@/lib/institutional.server");
          return Response.json(buildDealDeck(data as any), { headers: CORS });
        } catch (e) {
          console.error("[deal-deck] failed", e);
          return Response.json({ error: "deck_failed" }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
