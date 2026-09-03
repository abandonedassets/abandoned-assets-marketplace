// Maker/Taker liquidity incentives.
// Makers park standing pre-cleared capital -> fee discount.
// Takers snipe without standing capital -> latency premium.

export const MAKER_MIN_CAPITAL = 1_000_000;
export const MAKER_MIN_DAYS = 30;
export const MAKER_DISCOUNT_BPS = -50; // -0.50%
export const TAKER_PREMIUM_BPS = 300; // +3.00%

type Row = Record<string, any>;

/** Recompute maker/taker classification for every active buyer. */
export async function syncMakerTakerProfiles() {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("buyer_buy_boxes")
      .select("buyer_id,capital_to_deploy_usd,created_at,active,deprecated_at")
      .eq("active", true)
      .is("deprecated_at", null)
      .limit(500);

    const agg = new Map<string, { cap: number; since: number }>();
    for (const b of (data ?? []) as Row[]) {
      const id = b["buyer_id"];
      if (!id) continue;
      const cur = agg.get(id) ?? { cap: 0, since: Date.now() };
      cur.cap += Number(b["capital_to_deploy_usd"] ?? 0);
      const t = b["created_at"] ? Date.parse(b["created_at"]) : Date.now();
      cur.since = Math.min(cur.since, t);
      agg.set(id, cur);
    }

    const { loadParams } = await import("@/lib/meta-evolution.server");
    const params = await loadParams();
    const discount = Math.round(params["maker_discount_bps"] ?? MAKER_DISCOUNT_BPS);
    const premium = Math.round(params["taker_premium_bps"] ?? TAKER_PREMIUM_BPS);

    let makers = 0;
    for (const [buyerId, v] of agg) {
      const days = (Date.now() - v.since) / 86_400_000;
      const isMaker = v.cap >= MAKER_MIN_CAPITAL && days >= MAKER_MIN_DAYS;
      if (isMaker) makers += 1;
      try {
        await supabaseAdmin.from("maker_taker_profiles").upsert(
          {
            buyer_id: buyerId,
            standing_capital_usd: v.cap,
            standing_since: new Date(v.since).toISOString(),
            classification: isMaker ? "MAKER" : "TAKER",
            fee_modifier_bps: isMaker ? discount : premium,
            last_evaluated_at: new Date().toISOString(),
          } as never,
          { onConflict: "buyer_id" },
        );
      } catch {
        /* fail-forward */
      }
    }
    return { ok: true, buyers: agg.size, makers, takers: agg.size - makers };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Fee modifier in basis points for a buyer (0 when unknown). */
export async function feeModifierBps(buyerId: string | null): Promise<number> {
  if (!buyerId) return TAKER_PREMIUM_BPS;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("maker_taker_profiles")
      .select("fee_modifier_bps")
      .eq("buyer_id", buyerId)
      .maybeSingle();
    return Number((data as Row | null)?.["fee_modifier_bps"] ?? TAKER_PREMIUM_BPS);
  } catch {
    return 0;
  }
}

/** Apply the modifier to a base price/fee. */
export function applyModifier(amount: number, bps: number): number {
  return Math.round(amount * (1 + bps / 10_000));
}
