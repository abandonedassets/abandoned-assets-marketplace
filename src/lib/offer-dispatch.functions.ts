import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";

/** Fire the matched offer email for one pipeline item and stamp delivery state. */
export const sendOfferNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dealId: string }) => input)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { dispatch_offer } = await import("./dispatch-gmail.server");

    const { data: deal, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id, external_id, apn, address, city, zip, base_contract_price, optimized_acquisition_premium, title_status, matched_buy_box_id",
      )
      .eq("id", data.dealId)
      .maybeSingle();
    if (error || !deal) return { ok: false, error: error?.message ?? "deal_not_found" };
    if (!deal.matched_buy_box_id) return { ok: false, error: "no_matched_buy_box" };

    const { data: box } = await supabaseAdmin
      .from("buyer_buy_boxes")
      .select("id, label, contact_email")
      .eq("id", deal.matched_buy_box_id)
      .maybeSingle();
    if (!box?.contact_email) return { ok: false, error: "buy_box_has_no_contact_email" };

    const res = await dispatch_offer(deal, {
      id: box.id,
      contact_email: box.contact_email,
      label: box.label,
    });

    if (res.ok) {
      await supabaseAdmin
        .from("closing_pipeline_items")
        .update({
          offer_sent_at: new Date().toISOString(),
          offer_stage: "sent",
          tif_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        } as never)
        .eq("id", deal.id);
    }

    return { ...res, to: box.contact_email };
  });
