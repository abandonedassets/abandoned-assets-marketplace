// Aggressive clearinghouse engine.
// 1. Reverse capital flow — direct ACH debit pull against a buyer's mandate.
// 2. Algorithmic title underwriting — programmatic abstract, no title co latency.
// 3. Remote notary completion → 4. flash bridge dispatch from dry powder.
// Fail-forward: every function returns a typed result and never throws.

export type PullResult =
  | { ok: true; ref: string; status: string; amount_usd: number }
  | { ok: false; error: string; detail?: string };

/** Reverse Capital Flow: pull the buyer's funds instead of waiting for a push. */
export async function pullBuyerCapital(input: {
  dealId: string;
  buyerId: string;
  amountUsd: number;
  memo?: string;
}): Promise<PullResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: buyer } = await supabaseAdmin
      .from("buyer_buy_boxes")
      .select(
        "id, buyer_name, contact_email, debit_mandate_status, debit_routing_number, debit_account_number, debit_account_holder",
      )
      .eq("id", input.buyerId)
      .maybeSingle();
    if (!buyer) return { ok: false, error: "buyer_not_found" };

    const b = buyer as Record<string, any>;
    if (String(b["debit_mandate_status"] ?? "NONE").toUpperCase() !== "ACTIVE")
      return { ok: false, error: "debit_mandate_inactive" };

    const { stripeAchDebit } = await import("@/lib/stripe-ach.server");
    const pull = await stripeAchDebit({
      dealId: input.dealId,
      amountUsd: input.amountUsd,
      memo: input.memo ?? `Assignment settlement — deal ${input.dealId.slice(0, 8)}`,
      bank: {
        routing_number: String(b["debit_routing_number"] ?? ""),
        account_number: String(b["debit_account_number"] ?? ""),
        account_holder_name: String(b["debit_account_holder"] ?? b["buyer_name"] ?? ""),
        account_holder_type: "company",
      },
      counterpartyEmail: b["contact_email"] ?? null,
      idempotencyKey: `pull_${input.dealId}_${Math.round(input.amountUsd * 100)}`,
    });

    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        debit_pull_status: pull.ok ? "IN_TRANSIT" : "FAILED",
        debit_pull_ref: pull.ok ? pull.id : null,
        debit_pull_at: new Date().toISOString(),
      } as never)
      .eq("id", input.dealId);

    if (!pull.ok)
      return { ok: false, error: pull.error, ...(pull.detail ? { detail: pull.detail } : {}) };
    return { ok: true, ref: pull.id, status: pull.status, amount_usd: input.amountUsd };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Algorithmic title underwriting — deterministic risk score, 0 (clean) → 100 (toxic). */
export function scoreTitleRisk(row: Record<string, any>): { score: number; clear: boolean; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const status = String(row["title_status"] ?? "Pending").toUpperCase();
  if (status === "UNINSURABLE") {
    score += 60;
    reasons.push("TITLE_UNINSURABLE");
  } else if (status === "PENDING") {
    score += 10;
    reasons.push("TITLE_PENDING");
  }

  const liens = Number(row["lien_total"] ?? 0);
  const value = Number(row["base_contract_price"] ?? row["assessed_value"] ?? 0);
  if (liens > 0 && value > 0) {
    const ratio = liens / value;
    if (ratio > 0.6) {
      score += 40;
      reasons.push("LIEN_RATIO_SEVERE");
    } else if (ratio > 0.25) {
      score += 20;
      reasons.push("LIEN_RATIO_ELEVATED");
    } else {
      score += 5;
    }
  }

  if (!row["apn"]) {
    score += 15;
    reasons.push("NO_PARCEL_ID");
  }
  if (row["is_dip"] && !row["dip_free_and_clear"]) {
    score += 25;
    reasons.push("DIP_NOT_FREE_AND_CLEAR");
  }

  score = Math.max(0, Math.min(100, score));
  return { score, clear: score <= 25, reasons };
}

/** Run the programmatic abstract and persist the authorization flag. */
export async function underwriteTitle(dealId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id, title_status, lien_total, base_contract_price, assessed_value, apn, is_dip, dip_free_and_clear")
      .eq("id", dealId)
      .maybeSingle();
    if (!row) return { ok: false, error: "deal_not_found" };

    const verdict = scoreTitleRisk(row as Record<string, any>);
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        title_risk_score: verdict.score,
        algo_title_clear: verdict.clear,
        title_underwritten_at: new Date().toISOString(),
      } as never)
      .eq("id", dealId);

    return { ok: true, deal_id: dealId, ...verdict };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Flash Settlement Bridge: on notarization, dispatch proprietary dry powder to
 * the seller immediately; the buyer's inbound pull backfills the reserve.
 */
export async function flashBridge(dealId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: deal } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id, zip, address, base_contract_price, optimized_acquisition_premium, algo_title_clear, notary_status, flash_bridge_status",
      )
      .eq("id", dealId)
      .maybeSingle();
    if (!deal) return { ok: false, error: "deal_not_found" };

    const d = deal as Record<string, any>;
    if (String(d["flash_bridge_status"]) === "DISPATCHED")
      return { ok: true, skipped: "already_bridged", deal_id: dealId };
    if (!d["algo_title_clear"]) return { ok: false, error: "title_not_algorithmically_clear" };
    if (String(d["notary_status"] ?? "NONE").toUpperCase() !== "COMPLETED")
      return { ok: false, error: "notarization_incomplete" };

    const sellerNet =
      Number(d["base_contract_price"] ?? 0) - Number(d["optimized_acquisition_premium"] ?? 0);
    if (!isFinite(sellerNet) || sellerNet <= 0) return { ok: false, error: "invalid_seller_net" };

    const { issueWireCredit } = await import("@/lib/bluevine-rails.server");
    const dispatch = await issueWireCredit({
      dealId,
      amountUsd: sellerNet,
      memo: `Flash bridge seller disbursement — deal ${dealId.slice(0, 8)}`,
      beneficiaryName: String(d["address"] ?? `Seller ${dealId.slice(0, 8)}`),
      idempotencyKey: `flash_bridge_${dealId}`,
    });

    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        flash_bridge_status: dispatch.ok ? "DISPATCHED" : "FAILED",
        flash_bridge_amount_usd: sellerNet,
        flash_bridge_at: new Date().toISOString(),
      } as never)
      .eq("id", dealId);

    try {
      const { appendLedger } = await import("@/lib/event-ledger.server");
      await appendLedger({
        entity: "closing_pipeline_items",
        entityId: dealId,
        operation: "FLASH_BRIDGE_DISPATCH",
        actor: "notary_webhook",
        after: { seller_net_usd: sellerNet, ok: dispatch.ok },
      });
    } catch {}

    return dispatch.ok
      ? { ok: true, deal_id: dealId, seller_net_usd: sellerNet, ref: dispatch.id }
      : { ok: false, error: dispatch.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
