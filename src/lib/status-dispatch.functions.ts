import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DISPATCH_STATES = ["SETTLEMENT", "DUE", "CLOSED"] as const;

/**
 * Immediate status mutation + inline dispatch.
 * When a deal moves to SETTLEMENT / DUE / CLOSED we fire syndication (wire block email)
 * and title ordering right away. The cron sweep stays active as a fallback.
 */
export const setDealStatusAndDispatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: string }) => {
    if (!d?.id) throw new Error("id_required");
    if (!d?.status) throw new Error("status_required");
    return { id: String(d.id), status: String(d.status) };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("closing_pipeline_items")
      .update({ status: data.status } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    const key = data.status.toUpperCase();
    const shouldDispatch = DISPATCH_STATES.some((s) => key.includes(s));
    if (!shouldDispatch) return { ok: true as const, status: data.status, dispatched: false };

    let syndicated = false;
    let titled = false;

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: asset } = await supabaseAdmin
        .from("closing_pipeline_items")
        .select(
          "id,address,city,state,zip,asset_type,base_contract_price,optimized_acquisition_premium,matched_buyer_id,buyer_tier_stage",
        )
        .eq("id", data.id)
        .maybeSingle();
      if (asset) {
        const { syndicateAsset } = await import("@/lib/syndication.server");
        await syndicateAsset(asset as never);
        syndicated = true;
      }
    } catch (e) {
      console.error("[status-dispatch] syndication failed", data.id, e);
    }

    try {
      const { orderTitle } = await import("@/lib/title-order.server");
      const r = await orderTitle(data.id, "MANUAL");
      titled = Boolean(r?.ordered);
    } catch (e) {
      console.error("[status-dispatch] title order failed", data.id, e);
    }

    return { ok: true as const, status: data.status, dispatched: true, syndicated, titled };
  });
