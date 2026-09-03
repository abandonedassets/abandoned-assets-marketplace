// Automated Earnest Money Deposit (EMD) micro-hold.
// Sign 3 cannot complete until the buyer has a live $1,000 EMD authorization.
// Fail-forward: never throws into the signing path.

export const EMD_AMOUNT_USD = 1000;

export async function getEmdState(token: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("esign_requests")
    .select("id, buyer_email, emd_hold_status, emd_hold_amount, emd_hold_ref, pipeline_item_id")
    .eq("token", token)
    .maybeSingle();
  return data as any;
}

/** Issue (or reuse) a Bluevine ACH debit that captures the EMD hold. */
export async function createEmdHold(
  token: string,
  origin: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const row = await getEmdState(token);
    if (!row) return { ok: false, error: "not_found" };
    if (row.emd_hold_status === "authorized") return { ok: false, error: "already_authorized" };

    const amountUsd = Number(row.emd_hold_amount ?? EMD_AMOUNT_USD);
    const { issueAchDebit } = await import("@/lib/bluevine-rails.server");
    const rail = await issueAchDebit({
      dealId: String(row.pipeline_item_id ?? token),
      amountUsd,
      memo: `Non-refundable Earnest Money Deposit (EMD) \u2014 ${token}`,
      counterpartyEmail: row.buyer_email ?? null,
      counterpartyRef: token,
      idempotencyKey: `bv_emd_${token}`,
      origin,
    });
    if (!rail.ok) {
      console.error("[emd] bluevine debit failed", rail.error);
      return { ok: false, error: rail.error };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("esign_requests")
      .update({ emd_hold_status: "pending", emd_hold_ref: rail.id } as never)
      .eq("id", row.id);

    return { ok: true, url: rail.url };
  } catch (e) {
    console.error("[emd] createEmdHold failed", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Called by the Bluevine settlement webhook when the EMD debit settles. */

export async function markEmdAuthorized(token: string, ref?: string | null) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("esign_requests")
      .update({
        emd_hold_status: "authorized",
        emd_hold_ref: ref ?? null,
        emd_hold_authorized_at: new Date().toISOString(),
      } as never)
      .eq("token", token)
      .select("pipeline_item_id")
      .maybeSingle();

    // Sign-3 EMD lock → auto-order title commitment, lien search, closing pkg.
    const dealId = (row as any)?.pipeline_item_id;
    if (dealId) {
      try {
        const { orderTitle } = await import("@/lib/title-order.server");
        await orderTitle(String(dealId), "SIGN3_EMD_LOCK");
      } catch (e) {
        console.error("[emd] title order failed", e);
      }
    }
  } catch (e) {
    console.error("[emd] markEmdAuthorized failed", e);
  }
}
