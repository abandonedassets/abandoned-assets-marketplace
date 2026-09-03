// HFT Squeeze: TTL micro-auctions. Top-3 matched buy boxes get a 15-second
// offer. On lapse the offer self-destructs, the price ratchets up, and the
// asset cascades to the next tier. Slow capital pays more.

export const TTL_SECONDS = 15;
export const RATCHET_USD = 1000;

type Row = Record<string, any>;

/** Open a tiered TTL auction for one asset against matched boxes. */
export async function openMicroAuction(input: {
  dealId: string;
  price: number;
  boxes: { id: string; buyer_id: string | null }[];
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadParams } = await import("@/lib/meta-evolution.server");
    const params = await loadParams();
    const ttl = Math.round(params["ttl_seconds"] ?? TTL_SECONDS);
    const ratchet = Math.round(params["ratchet_usd"] ?? RATCHET_USD);
    const tierCount = Math.round(params["dispatch_tiers"] ?? 3);
    const tiers = input.boxes.slice(0, tierCount);
    if (!tiers.length) return { ok: true, opened: 0 };
    const rows = tiers.map((b, i) => ({
      pipeline_item_id: input.dealId,
      tier: i + 1,
      buy_box_id: b.id,
      buyer_id: b.buyer_id,
      offer_price: input.price + i * ratchet,
      ttl_seconds: ttl,
      expires_at: new Date(Date.now() + (i + 1) * ttl * 1000).toISOString(),
      ratchet_usd: ratchet,
    }));
    const { error } = await supabaseAdmin.from("ttl_micro_auctions").insert(rows as never);
    if (error) return { ok: false, opened: 0, error: error.message };
    return { ok: true, opened: rows.length };
  } catch (e) {
    return { ok: false, opened: 0, error: (e as Error).message };
  }
}

/** Expire lapsed offers and ratchet asset pricing (DB-side, bounded). */
export async function sweepMicroAuctions(max = 200) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("sweep_ttl_auctions", {
      _max: max,
    } as never);
    if (error) return { ok: false, expired: 0, error: error.message };
    return { ok: true, expired: ((data ?? []) as Row[]).length };
  } catch (e) {
    return { ok: false, expired: 0, error: (e as Error).message };
  }
}

/** Mark an auction filled when a buyer locks inside the TTL window. */
export async function fillMicroAuction(dealId: string, buyBoxId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("ttl_micro_auctions")
      .update({ status: "FILLED" } as never)
      .eq("pipeline_item_id", dealId)
      .eq("buy_box_id", buyBoxId)
      .eq("status", "LIVE");
    await supabaseAdmin
      .from("ttl_micro_auctions")
      .update({ status: "CANCELLED" } as never)
      .eq("pipeline_item_id", dealId)
      .eq("status", "LIVE");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
