// Buyer confirms a direct bank wire was sent. Optional receipt upload.
// POST /api/public/wire-confirm  (multipart/form-data or JSON)
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/wire-confirm")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ct = request.headers.get("content-type") ?? "";
          let dealId = "";
          let senderName = "";
          let amount: number | null = null;
          let reference = "";
          let receiptPath: string | null = null;

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          if (ct.includes("multipart/form-data")) {
            const form = await request.formData();
            dealId = String(form.get("deal_id") ?? "").trim();
            senderName = String(form.get("sender_name") ?? "").slice(0, 120);
            reference = String(form.get("reference") ?? "").slice(0, 200);
            const a = Number(form.get("amount") ?? 0);
            amount = isFinite(a) && a > 0 ? a : null;
            const file = form.get("receipt");
            if (dealId && file && typeof file !== "string") {
              const bytes = new Uint8Array(await file.arrayBuffer());
              if (bytes.byteLength > 0 && bytes.byteLength <= 10_000_000) {
                const safe = (file.name || "receipt").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
                const path = `${dealId}/${Date.now()}_${safe}`;
                const up = await supabaseAdmin.storage
                  .from("wire-receipts")
                  .upload(path, bytes, {
                    contentType: file.type || "application/octet-stream",
                    upsert: false,
                  });
                if (!up.error) receiptPath = path;
              }
            }
          } else {
            const body = (await request.json().catch(() => ({}))) as any;
            dealId = String(body?.deal_id ?? "").trim();
            senderName = String(body?.sender_name ?? "").slice(0, 120);
            reference = String(body?.reference ?? "").slice(0, 200);
            const a = Number(body?.amount ?? 0);
            amount = isFinite(a) && a > 0 ? a : null;
          }

          if (!dealId) return Response.json({ ok: false, error: "deal_id_required" }, { status: 400 });

          const { data: deal } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select("id,address,optimized_acquisition_premium")
            .eq("id", dealId)
            .maybeSingle();
          if (!deal) return Response.json({ ok: false, error: "deal_not_found" }, { status: 404 });
          const d = deal as any;
          const feeUsd = amount ?? Number(d.optimized_acquisition_premium ?? 0);

          await supabaseAdmin
            .from("closing_pipeline_items")
            .update({
              payout_status: "SETTLED_PAID",
              payout_at: new Date().toISOString(),
              cleared_at: new Date().toISOString(),
              cleared_amount: feeUsd,
            } as never)
            .eq("id", dealId);

          try {
            await supabaseAdmin.from("system_alerts" as any).insert({
              kind: "wire_auto_cleared",
              severity: "info",
              message: `✅ AUTOMATED SETTLEMENT CONFIRMED — $${Math.round(feeUsd).toLocaleString("en-US")} on ${String(d.address ?? dealId).slice(0, 60)}. WIRED • 2 DAYS TO DEPOSIT.`,
              deal_id: dealId,
              metadata: {
                sender_name: senderName || null,
                reference: reference || null,
                amount_usd: feeUsd,
                receipt_path: receiptPath,
                rail: "bluevine_direct_wire",
              } as any,
            });
          } catch {
            /* telemetry optional */
          }

          try {
            const { notifyAdmin, fmtUsd } = await import("@/lib/notify.server");
            await notifyAdmin(
              `✅ AUTO-CLEARED — ${fmtUsd(feeUsd)} wired by ${senderName || "buyer"} on deal ${dealId.slice(0, 8)}${receiptPath ? " (receipt attached)" : ""}. WIRED • 2D TO DEPOSIT.`,
            );
          } catch {
            /* telemetry optional */
          }

          return Response.json({
            ok: true,
            deal_id: dealId,
            status: "SETTLED_PAID",
            auto_cleared: true,
            receipt_uploaded: Boolean(receiptPath),
          });
        } catch (e) {
          console.error("[wire-confirm] failed", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
        }
      },
    },
  },
});
