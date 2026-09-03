// Live e-signature status webhook.
// POST /api/webhooks/esign-status  { token? , deal_id?, event, state? }
// Optional HMAC: X-Signature: sha256 hex over the raw body using ESIGN_WEBHOOK_SECRET.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const Body = z.object({
  token: z.string().min(6).max(200).optional(),
  deal_id: z.string().uuid().optional(),
  event: z.string().min(1).max(80).optional(),
  state: z.string().min(1).max(40).optional(),
});

export const Route = createFileRoute("/api/webhooks/esign-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const raw = await request.text();

          const secret = process.env["ESIGN_WEBHOOK_SECRET"];
          if (secret) {
            const sig = request.headers.get("x-signature") ?? "";
            const expected = createHmac("sha256", secret).update(raw).digest("hex");
            const a = Buffer.from(sig);
            const b = Buffer.from(expected);
            if (a.length !== b.length || !timingSafeEqual(a, b)) {
              return Response.json({ error: "invalid_signature" }, { status: 401 });
            }
          }

          let json: unknown = {};
          try {
            json = JSON.parse(raw || "{}");
          } catch {
            return Response.json({ error: "invalid_json" }, { status: 400 });
          }
          const parsed = Body.safeParse(json);
          if (!parsed.success)
            return Response.json({ error: "invalid_payload" }, { status: 400 });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { setContractState, mapEsignEvent, isContractState } = await import(
            "@/lib/contract-state.server"
          );

          let dealId = parsed.data.deal_id ?? null;
          if (!dealId && parsed.data.token) {
            const { data } = await supabaseAdmin
              .from("esign_requests")
              .select("pipeline_item_id")
              .eq("token", parsed.data.token)
              .maybeSingle();
            dealId = (data as any)?.pipeline_item_id ?? null;
          }
          if (!dealId) return Response.json({ error: "deal_not_found" }, { status: 404 });

          const explicit = parsed.data.state?.toUpperCase();
          const next =
            explicit && isContractState(explicit)
              ? explicit
              : mapEsignEvent(parsed.data.event ?? "");
          if (!next) return Response.json({ error: "unmapped_event" }, { status: 422 });

          const r = await setContractState(dealId, next);
          return Response.json({ received: true, deal_id: dealId, contract_state: next, r });
        } catch (e) {
          console.error("[esign-status] failed", e);
          return Response.json({ error: "unhandled" }, { status: 500 });
        }
      },
    },
  },
});
