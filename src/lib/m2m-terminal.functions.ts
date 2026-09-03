import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type M2MWire = {
  id: string;
  address: string | null;
  zip: string | null;
  memo_id: string;
  fee_usd: number;
  dispatched_at: string;
  deadline: string;
};

export type M2MTerminalStats = {
  active_inventory: number;
  live_pipeline_value: number;
  settled_cash: number;
  matched_buyers: number;
  buy_boxes: number;
  offers_dispatched: number;
  pending_wires: M2MWire[];
  pending_value: number;
  match_rate: number;
  projection_30d: number;
};

const WIRE_WINDOW_MS = 48 * 60 * 60 * 1000;

export const getM2MTerminal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<M2MTerminalStats> => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [inventory, boxes, offers, rows] = await Promise.all([
      supabaseAdmin
        .from("closing_pipeline_items")
        .select("id", { count: "exact", head: true })
        .not("status", "in", '("Rejected","Archived")'),
      supabaseAdmin
        .from("buyer_buy_boxes")
        .select("id", { count: "exact", head: true })
        .eq("active", true)
        .not("contact_email", "is", null),
      supabaseAdmin
        .from("offer_delivery_logs")
        .select("id", { count: "exact", head: true })
        .not("meta->synthetic", "eq", true),
      supabaseAdmin
        .from("closing_pipeline_items")
        .select(
          "id,address,zip,status,payout_status,optimized_acquisition_premium,cleared_amount,cleared_at,matched_buy_box_id,offer_sent_at,tif_dispatched_at,updated_at",
        )
        .limit(5000),
    ]);

    const items = (rows.data ?? []) as any[];
    let pipeline = 0;
    let settled = 0;
    let matched = 0;
    let pendingValue = 0;
    const wires: M2MWire[] = [];

    for (const r of items) {
      const status = String(r.status ?? "");
      if (status === "Rejected" || status === "Archived") continue;
      const fee = Number(r.optimized_acquisition_premium ?? 0) || 0;
      if (r.matched_buy_box_id) matched++;
      if (r.payout_status === "SETTLED_PAID") {
        settled += Number(r.cleared_amount ?? fee) || 0;
        continue;
      }
      pipeline += fee;
      if (r.payout_status === "WIRE_PENDING_VERIFICATION") {
        pendingValue += fee;
        const start = String(r.offer_sent_at ?? r.tif_dispatched_at ?? r.updated_at ?? new Date().toISOString());
        wires.push({
          id: r.id,
          address: r.address ?? null,
          zip: r.zip ?? null,
          memo_id: `AA-${String(r.id).slice(0, 8).toUpperCase()}`,
          fee_usd: fee,
          dispatched_at: start,
          deadline: new Date(new Date(start).getTime() + WIRE_WINDOW_MS).toISOString(),
        });
      }
    }

    wires.sort((a, b) => a.deadline.localeCompare(b.deadline));

    const total = items.length || 1;
    const matchRate = matched / total;
    // 30-day settled-fee forecast: pending clearing window (T+2) turns over ~15x
    // in 30 days, scaled by the observed match rate.
    const projection = Math.round(pendingValue * matchRate * 15);

    return {
      active_inventory: inventory.count ?? 0,
      live_pipeline_value: Math.round(pipeline),
      settled_cash: Math.round(settled),
      matched_buyers: matched,
      buy_boxes: boxes.count ?? 0,
      offers_dispatched: offers.count ?? 0,
      pending_wires: wires.slice(0, 50),
      pending_value: Math.round(pendingValue),
      match_rate: Number(matchRate.toFixed(4)),
      projection_30d: projection,
    };
  });
