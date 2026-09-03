// Non-Performer Scorecard — buyer reliability ledger.
// Every claim, funding, EMD timeout and failed proof-of-funds check adjusts a
// buyer's reliability score. Priority buyers get the 30-minute head start on
// deal drops; purged buyers are excluded from dispatch entirely.
// Fail-forward: scorecard errors never stall the revenue path.

export type BuyerEvent = "claimed" | "funded" | "emd_timeout" | "pof_failed";
export type BuyerTier = "priority" | "standard" | "delayed" | "purged";

export const PRIORITY_HEAD_START_MS = 30 * 60 * 1000;
/** Chronic lock-squatters (execution rate < 40%) lose real-time feed access. */
export const DELAYED_TIER_LAG_MS = 15 * 60 * 1000;

export async function recordBuyerEvent(email: string | null | undefined, event: BuyerEvent) {
  try {
    if (!email) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any).rpc("record_buyer_event", {
      _email: email.trim().toLowerCase(),
      _event: event,
    });
    return data ?? null;
  } catch (e) {
    console.error("[scorecard] record failed", (e as Error).message);
    return null;
  }
}

/** Current tier for a buyer. Unknown buyers are 'standard' (never blocked). */
export async function buyerTier(email: string | null | undefined): Promise<BuyerTier> {
  try {
    if (!email) return "standard";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("buyer_scorecards" as never)
      .select("tier")
      .eq("buyer_email", email.trim().toLowerCase())
      .maybeSingle();
    const t = (data as { tier?: string } | null)?.tier;
    return t === "priority" || t === "purged" || t === "delayed" ? t : "standard";
  } catch {
    return "standard";
  }
}

/**
 * Tiered dispatch gate.
 *  - purged   → never dispatched.
 *  - priority → dispatched immediately.
 *  - standard → held until the 30-minute priority window has elapsed.
 */
export async function canDispatchNow(
  email: string | null | undefined,
  dealReadyAtMs: number,
): Promise<{ allowed: boolean; tier: BuyerTier; reason?: string }> {
  const tier = await buyerTier(email);
  if (tier === "purged") return { allowed: false, tier, reason: "buyer_purged" };
  if (tier === "priority") return { allowed: true, tier };
  const elapsed = Date.now() - dealReadyAtMs;
  const gate =
    tier === "delayed"
      ? PRIORITY_HEAD_START_MS + DELAYED_TIER_LAG_MS
      : PRIORITY_HEAD_START_MS;
  return elapsed >= gate
    ? { allowed: true, tier }
    : {
        allowed: false,
        tier,
        reason: tier === "delayed" ? "execution_rate_throttled" : "priority_window_active",
      };
}

/** Sorted dispatch order: priority buyers first, then by score. */
export async function rankBuyers(emails: string[]): Promise<
  Array<{ email: string; tier: BuyerTier; score: number }>
> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const lower = emails.map((e) => e.trim().toLowerCase());
    const { data } = await supabaseAdmin
      .from("buyer_scorecards" as never)
      .select("buyer_email, tier, reliability_score")
      .in("buyer_email", lower);
    const map = new Map(
      ((data ?? []) as Array<Record<string, any>>).map((r) => [
        r["buyer_email"] as string,
        { tier: (r["tier"] ?? "standard") as BuyerTier, score: Number(r["reliability_score"] ?? 100) },
      ]),
    );
    return lower
      .map((email) => ({
        email,
        tier: map.get(email)?.tier ?? ("standard" as BuyerTier),
        score: map.get(email)?.score ?? 100,
      }))
      .filter((b) => b.tier !== "purged")
      .sort((a, b) => {
        const rank = (t: BuyerTier) => (t === "priority" ? 0 : t === "standard" ? 1 : 2);
        return rank(a.tier) === rank(b.tier) ? b.score - a.score : rank(a.tier) - rank(b.tier);
      });
  } catch {
    return emails.map((email) => ({ email, tier: "standard" as BuyerTier, score: 100 }));
  }
}
