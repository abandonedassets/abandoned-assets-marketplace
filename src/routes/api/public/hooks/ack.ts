// NASA telemetry: two-way webhook handshake (SYN -> ACK).
// Buyers must pingback within 30s of dispatch with a cryptographic token.
// POST { deal_id, buyer_acknowledgement_token, buyer_id? }
// GET  -> sweeps un-ACKed dispatches older than 30s and fails over to the
//         next standing buy box.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

const ACK_WINDOW_MS = 30_000;

function expectedToken(dealId: string, secret: string) {
  return createHmac("sha256", secret).update(`ack:${dealId}`).digest("hex");
}

export const Route = createFileRoute("/api/public/hooks/ack")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as Record<string, unknown>;
          const dealId = String(body["deal_id"] ?? "");
          const token = String(body["buyer_acknowledgement_token"] ?? "");
          const secret = process.env["ACK_SIGNING_SECRET"] ?? process.env["VDR_SIGNING_SECRET"] ?? "";
          if (!dealId || !token || !secret) {
            return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
          }
          const exp = expectedToken(dealId, secret);
          const a = Buffer.from(token);
          const b = Buffer.from(exp);
          if (a.length !== b.length || !timingSafeEqual(a, b)) {
            return Response.json({ ok: false, error: "bad_token" }, { status: 401 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin
            .from("closing_pipeline_items")
            .update({ escrow_status: "EMD_PENDING" } as never)
            .eq("id", dealId);
          await supabaseAdmin
            .from("system_audit_logs")
            .insert({
              pipeline_item_id: dealId,
              event_type: "BUYER_ACK",
              reason: "Two-way handshake confirmed within window",
            } as never)
            .then(undefined, () => {});

          return Response.json({ ok: true, escrow_status: "EMD_PENDING" });
        } catch (e) {
          console.error("[ack] failed", e);
          return Response.json({ ok: false, error: "error" }, { status: 200 });
        }
      },

      // Failover sweep: dispatched but no ACK inside the 30s window.
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const cutoff = new Date(Date.now() - ACK_WINDOW_MS).toISOString();
          const { data } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select("id, matched_buy_box_id, base_contract_price, optimized_acquisition_premium, zip, asset_type")
            .eq("status", "Webhook_Dispatched")
            .is("escrow_status", null)
            .lt("updated_at", cutoff)
            .limit(50);

          const rows = (data ?? []) as Array<Record<string, any>>;
          let failed_over = 0;

          for (const r of rows) {
            try {
              const { data: boxes } = await supabaseAdmin
                .from("buyer_buy_boxes")
                .select("id, buyer_id, max_contract_price, min_placement_margin")
                .eq("active", true)
                .is("deprecated_at", null)
                .neq("id", r["matched_buy_box_id"] ?? "00000000-0000-0000-0000-000000000000")
                .gte("max_contract_price", Number(r["base_contract_price"] ?? 0))
                .order("urgency_score", { ascending: false })
                .limit(1);
              const next = (boxes ?? [])[0] as Record<string, any> | undefined;
              if (!next) continue;

              await supabaseAdmin
                .from("closing_pipeline_items")
                .update({
                  matched_buy_box_id: next["id"],
                  matched_buyer_id: next["buyer_id"],
                  updated_at: new Date().toISOString(),
                } as never)
                .eq("id", r["id"]);
              failed_over += 1;
            } catch (e) {
              console.error("[ack] failover row failed", e);
            }
          }

          return Response.json({ ok: true, scanned: rows.length, failed_over });
        } catch (e) {
          console.error("[ack] sweep failed", e);
          return Response.json({ ok: false, error: "error" }, { status: 200 });
        }
      },
    },
  },
});
