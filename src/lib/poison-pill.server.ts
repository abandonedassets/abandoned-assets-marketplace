// Cross-Collateralized Poison Pill: confession of judgment + cross-collateral
// rider attached at execution, auto-triggered on a busted TIF lock.

export const DEFAULT_LIQUIDATED_DAMAGES = 25_000;

type Row = Record<string, any>;

export function poisonPillHtml(damages = DEFAULT_LIQUIDATED_DAMAGES): string {
  return `<div style="border:1px solid #b00;padding:10px;margin:12px 0;font:12px monospace;color:#600">
  <b>CROSS-COLLATERALIZATION RIDER &amp; CONFESSION OF JUDGMENT.</b>
  Buyer and every affiliated entity under common control grant Assignor a security interest in all
  real property currently held by them, cross-collateralized to secure performance hereunder.
  Upon failure to fund within the hardened 24-hour EMD/TIF window, Buyer irrevocably confesses
  judgment in the amount of $${damages.toLocaleString("en-US")} plus costs, and authorizes the
  automated filing of liens against all affiliate-held parcels to the extent of that amount.
  </div>`;
}

/** Attach the rider at contract generation. */
export async function attachRider(input: {
  dealId: string;
  buyerEmail: string;
  buyerEntity?: string | null;
  damages?: number;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("poison_pill_riders").insert({
      pipeline_item_id: input.dealId,
      buyer_email: input.buyerEmail,
      buyer_entity: input.buyerEntity ?? null,
      liquidated_damages_usd: input.damages ?? DEFAULT_LIQUIDATED_DAMAGES,
    } as never);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Fire the pill for defaulted deals (busted locks / voided EMD). */
export async function triggerPoisonPills(dealIds: string[]) {
  if (!dealIds.length) return { ok: true, triggered: 0 };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("poison_pill_riders")
      .update({
        triggered_at: new Date().toISOString(),
        trigger_reason: "TIF_LOCK_BUST_NONPERFORMANCE",
      } as never)
      .in("pipeline_item_id", dealIds as never)
      .is("triggered_at", null)
      .select("id, pipeline_item_id, buyer_email, liquidated_damages_usd");

    const fired = (data ?? []) as Row[];
    for (const r of fired) {
      try {
        await supabaseAdmin.from("system_audit_logs").insert({
          pipeline_item_id: r["pipeline_item_id"],
          event_type: "POISON_PILL_TRIGGERED",
          reason: `Cross-collateral lien authorized for $${r["liquidated_damages_usd"]}`,
          payload: r as never,
        } as never);
      } catch {
        /* fail-forward */
      }
    }
    return { ok: true, triggered: fired.length };
  } catch (e) {
    return { ok: false, triggered: 0, error: (e as Error).message };
  }
}
