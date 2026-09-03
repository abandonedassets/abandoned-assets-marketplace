// Reverse-strike waterfall: any wire hold older than 48h is cancelled and the
// asset is re-dispatched to the next buyer in the queue. Fail-forward: never
// throws, always 200.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/wire-waterfall")({
  server: { handlers: { GET: () => run(), POST: () => run() } },
});

const WINDOW_MS = 48 * 60 * 60 * 1000;

async function run() {
  const out: Record<string, unknown> = { ok: true, expired: 0, redispatched: 0 };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { dispatch_offer } = await import("@/lib/dispatch-gmail.server");
    const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();

    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id, external_id, apn, address, city, zip, base_contract_price, optimized_acquisition_premium, title_status, matched_buy_box_id, offer_sent_at, updated_at",
      )
      .eq("payout_status", "WIRE_PENDING_VERIFICATION")
      .lt("offer_sent_at", cutoff)
      .limit(25);

    for (const deal of (data ?? []) as any[]) {
      try {
        // Cancel the lapsed hold.
        await supabaseAdmin
          .from("closing_pipeline_items")
          .update({ payout_status: null, offer_stage: "expired" } as never)
          .eq("id", deal.id);
        out["expired"] = (out["expired"] as number) + 1;

        // Next buyer in the waterfall for this ZIP.
        const { data: boxes } = await supabaseAdmin
          .from("buyer_buy_boxes")
          .select("id, label, contact_email, target_zip_codes")
          .eq("active", true)
          .not("contact_email", "is", null)
          .limit(50);

        const next = ((boxes ?? []) as any[]).find(
          (b) =>
            b.id !== deal.matched_buy_box_id &&
            (!Array.isArray(b.target_zip_codes) ||
              b.target_zip_codes.length === 0 ||
              b.target_zip_codes.includes(deal.zip)),
        );
        if (!next) continue;

        const res = await dispatch_offer(deal, {
          id: next.id,
          contact_email: next.contact_email,
          label: next.label,
        });
        if (res.ok) {
          await supabaseAdmin
            .from("closing_pipeline_items")
            .update({
              matched_buy_box_id: next.id,
              offer_sent_at: new Date().toISOString(),
              offer_stage: "sent",
              payout_status: "WIRE_PENDING_VERIFICATION",
            } as never)
            .eq("id", deal.id);
          out["redispatched"] = (out["redispatched"] as number) + 1;
        }
      } catch (e) {
        console.error("[wire-waterfall] item failed", deal?.id, e);
      }
    }
  } catch (e) {
    out["ok"] = false;
    out["error"] = (e as Error).message;
  }
  return Response.json(out);
}
