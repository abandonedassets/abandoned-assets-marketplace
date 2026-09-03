// POST /api/v1/deals/feedback — funds report pass/reject/loi/bid on matched deals.
// Body: { deal_id, action, reason?, metadata? }
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const ACTIONS = ["pass", "reject", "loi", "bid"];

export const Route = createFileRoute("/api/v1/deals/feedback")({
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
          const action = String(body['action'] ?? "").toLowerCase();
          if (!dealId || !ACTIONS.includes(action))
            return Response.json(
              { error: "deal_id and valid action required" },
              { status: 400, headers: CORS },
            );

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: keyRow } = await supabaseAdmin
            .from("institutional_api_keys")
            .select("fund_id")
            .eq("id", authed.key.id)
            .maybeSingle();

          const { recordFeedback } = await import("@/lib/feedback.server");
          const res = await recordFeedback({
            deal_id: dealId,
            action: action as never,
            reason: (body['reason'] as string) ?? null,
            fund_id: (keyRow as { fund_id?: string | null } | null)?.fund_id ?? null,
            api_key_id: authed.key.id,
            metadata: (body['metadata'] as Record<string, unknown>) ?? {},
          });

          return Response.json({ ...res, ok: true }, { headers: CORS });
        } catch (e) {
          console.error("[deals/feedback] failed", e);
          return Response.json({ error: "unhandled" }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
