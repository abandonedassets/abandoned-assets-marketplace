// Hardened 24-Hour EMD Lock enforcement.
// Any executed assignment whose ACH EMD has not cleared within 24h of signature
// is programmatically voided and the asset cycles back to the live deal tape.
// Fail-forward: individual failures never stall the sweep.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/emd-void")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

          const { data: rows, error } = await supabaseAdmin
            .from("esign_requests")
            .select("id, pipeline_item_id, buyer_email, signed_at, status")
            .in("status", ["Signed", "Invoiced"])
            .lt("signed_at", cutoff)
            .limit(200);
          if (error) throw error;

          let voided = 0;
          for (const r of (rows ?? []) as Array<{
            id: string;
            pipeline_item_id: string;
            buyer_email: string;
          }>) {
            try {
              const { data: deal } = await supabaseAdmin
                .from("closing_pipeline_items")
                .select("id, cleared_at, status")
                .eq("id", r.pipeline_item_id)
                .maybeSingle();
              if (!deal || (deal as { cleared_at: string | null }).cleared_at) continue;

              await supabaseAdmin
                .from("esign_requests")
                .update({ status: "Voided-EMD-Timeout" } as never)
                .eq("id", r.id);

              await supabaseAdmin
                .from("closing_pipeline_items")
                .update({
                  status: "New",
                  escrow_status: null,
                  matched_buyer_id: null,
                  notification_queued: true,
                  updated_at: new Date().toISOString(),
                } as never)
                .eq("id", r.pipeline_item_id);

              try {
                const { recordBuyerEvent } = await import("@/lib/scorecard.server");
                await recordBuyerEvent(r.buyer_email, "emd_timeout");
              } catch {
                /* fail-forward */
              }

              const { writeAuditLog } = await import("@/lib/webhook-verify.server");
              await writeAuditLog({
                event_type: "EMD_LOCK_VOID",
                reason: "emd_not_cleared_within_24h",
                pipeline_item_id: r.pipeline_item_id,
                raw_payload: { esign_id: r.id, buyer_email: r.buyer_email },
              });
              voided++;
            } catch (inner) {
              console.error("[emd-void] row failed", inner);
            }
          }

          console.log(JSON.stringify({ stage: "emd_void", voided, ts: new Date().toISOString() }));
          return Response.json({ ok: true, voided });
        } catch (e) {
          console.error("[emd-void] failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
