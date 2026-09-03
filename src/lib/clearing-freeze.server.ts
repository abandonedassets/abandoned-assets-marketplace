// Suspended Animation lane: Stripe AML review parks the asset in
// CLEARING_FROZEN (off the tape, coordinates withheld) until review closes.
// Zero manual intervention; the only human touchpoint is a phone ping.

function intentIdOf(event: any): string | null {
  const o = event?.data?.object ?? {};
  const v = o.payment_intent ?? o.charge ?? o.id ?? null;
  return typeof v === "string" ? v : null;
}

async function dealForIntent(intent: string | null) {
  if (!intent) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The Stripe rails persist the reference in different columns: Checkout
  // session ids in stripe_session_id, PaymentIntent ids in the assignment-fee
  // and data-access-toll columns. Match any of them.
  const { data } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("id, status, optimized_acquisition_premium")
    .or(
      `stripe_session_id.eq.${intent},assignment_fee_intent_id.eq.${intent},toll_intent_id.eq.${intent}`,
    )
    .limit(1)
    .maybeSingle();
  return (data as Record<string, any> | null) ?? null;
}


export async function handleReviewEvent(event: any): Promise<
  { handled: false } | { handled: true; lane: string; deal_id: string | null }
> {
  const type = String(event?.type ?? "");
  if (type !== "review.opened" && type !== "review.closed") return { handled: false };

  const intent = intentIdOf(event);
  const deal = await dealForIntent(intent);
  if (!deal) return { handled: true, lane: `${type}_no_deal`, deal_id: null };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { notifyAdmin, fmtUsd } = await import("./notify.server");
  const amount = Number(deal["optimized_acquisition_premium"] ?? 0);

  if (type === "review.opened") {
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({ status: "CLEARING_FROZEN" } as never)
      .eq("id", deal["id"]);
    try {
      await notifyAdmin(
        `SYSTEM ALERT: STRIPE HOLD FROZEN FOR ${fmtUsd(amount)}. ASSET ${String(deal["id"]).slice(0, 8)} PARKED IN CLEARING_FROZEN. WAITING FOR STRIPE AML CLEARANCE.`,
        true,
      );
    } catch {}
    return { handled: true, lane: "clearing_frozen", deal_id: String(deal["id"]) };
  }

  // review.closed — release the coordinates automatically.
  await supabaseAdmin
    .from("closing_pipeline_items")
    .update({ status: "In-Escrow" } as never)
    .eq("id", deal["id"]);
  try {
    const { deliverUnlockPacket } = await import("./data-gate.server");
    await deliverUnlockPacket(String(deal["id"]));
  } catch (e) {
    console.error("[clearing-freeze] unlock failed", e);
  }
  return { handled: true, lane: "clearing_released", deal_id: String(deal["id"]) };
}
