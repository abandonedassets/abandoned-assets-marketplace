// Seller escrow leg — the capital that is NOT our assignment fee.
// Buyer funds land in the deal's FBO account; the fee is swept to the
// operating beneficiary matrix, and this module pushes the remainder to the
// seller's verified destination over the direct Bluevine wire rail.
// Fail-forward: never throws into the inbound webhook path.

export type SellerDisbursement =
  | { ok: true; transfer_id: string; amount: number }
  | { ok: false; reason: string };

type SellerRouting = {
  routing_number?: string | null;
  account_number?: string | null;
  beneficiary_name?: string | null;
  counterparty_id?: string | null;
  rail?: "wire" | "ach" | null;
};

function parseRouting(raw: unknown): SellerRouting | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const routing = (r["routing_number"] ?? r["routing"] ?? null) as string | null;
  const account = (r["account_number"] ?? r["account"] ?? null) as string | null;
  const cp = (r["counterparty_id"] ?? null) as string | null;
  if (!cp && (!routing || !account)) return null;
  return {
    routing_number: routing,
    account_number: account,
    counterparty_id: cp,
    beneficiary_name: (r["beneficiary_name"] ?? r["name"] ?? null) as string | null,
    rail: (r["rail"] as "wire" | "ach" | null) ?? null,
  };
}

/**
 * Disburse (inbound funds − assignment fee) to the seller.
 * Idempotent: a deal that already has seller_disbursement_id is a no-op.
 */
export async function disburseSellerRemainder(
  dealId: string,
  inboundUsd: number,
): Promise<SellerDisbursement> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: deal } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,address,optimized_acquisition_premium,seller_disbursement_id,seller_routing_json",
      )
      .eq("id", dealId)
      .maybeSingle();
    if (!deal) return { ok: false, reason: "deal_not_found" };
    const d = deal as any;
    if (d.seller_disbursement_id) return { ok: false, reason: "already_disbursed" };

    const fee = Number(d.optimized_acquisition_premium ?? 0) || 0;
    const remainder = Number((inboundUsd - fee).toFixed(2));
    if (!isFinite(remainder) || remainder <= 0) return { ok: false, reason: "no_remainder" };

    const routing = parseRouting(d.seller_routing_json);
    if (!routing) {
      // Funds stay in the FBO account until seller coordinates are verified.
      await supabaseAdmin.from("exception_queue" as any).insert({
        pipeline_item_id: dealId,
        reason: "seller_routing_missing",
        detail: `$${remainder.toLocaleString("en-US")} held in FBO — no verified seller destination on file.`,
      } as never);
      return { ok: false, reason: "seller_routing_missing" };
    }

    const { issueWireCredit } = await import("@/lib/bluevine-rails.server");
    const r = await issueWireCredit({
      dealId,
      amountUsd: remainder,
      memo: `Seller proceeds ${String(d.address ?? dealId).slice(0, 60)}`,
      beneficiaryName: routing.beneficiary_name ?? "Seller",
      idempotencyKey: `seller_${dealId}`,
    });
    if (!r.ok) return { ok: false, reason: r.error ?? "wire_failed" };

    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        seller_disbursement_id: r.id,
        seller_disbursed_at: new Date().toISOString(),
      } as never)
      .eq("id", dealId);

    return { ok: true, transfer_id: r.id ?? "", amount: remainder };
  } catch (e) {
    console.error("[seller-escrow] failed", e);
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
