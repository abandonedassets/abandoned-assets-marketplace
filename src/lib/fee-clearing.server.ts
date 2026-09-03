// Automated fee clearance + multi-tier split payout execution.
// Triggered only from a verified Stripe clearing event. Fail-forward:
// never throws into the settlement path.

import { splitProceeds } from "@/lib/beneficiary-routing";

export type FeeClearResult = {
  ok: boolean;
  deal_id: string;
  net_fee_usd: number;
  legs: Array<{ key: string; label: string; amount_usd: number; code: string }>;
  error?: string;
};

/** Compute the net assignment fee for a cleared deal. */
export function netAssignmentFee(row: any, clearedAmount: number): number {
  const fee = Number(row?.assignment_fee ?? 0);
  if (Number.isFinite(fee) && fee > 0) return fee;
  const amt = Number(clearedAmount ?? 0);
  return Number.isFinite(amt) && amt > 0 ? amt : 0;
}

export async function clearFeeAndSplit(
  dealId: string,
  clearedAmount: number,
  settlementRef: string,
): Promise<FeeClearResult> {
  const out: FeeClearResult = { ok: false, deal_id: dealId, net_fee_usd: 0, legs: [] };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("*")
      .eq("id", dealId)
      .maybeSingle();
    if (!row) return { ...out, error: "deal_not_found" };

    const r = row as any;
    const grossFee = netAssignmentFee(r, clearedAmount);

    // JV / co-wholesaler carve-out: settled in transit, before internal splits.
    const jvPct = Math.max(0, Math.min(100, Number(r.jv_fee_split_pct ?? 0)));
    const jvAmount = jvPct > 0 ? Math.round(grossFee * (jvPct / 100) * 100) / 100 : 0;
    const netFee = Math.max(0, grossFee - jvAmount);
    out.net_fee_usd = netFee;

    const valuation =
      Number(r.base_contract_price ?? 0) || Number(r.assessed_value ?? 0) || Number(clearedAmount ?? 0);

    const legs = splitProceeds(
      {
        id: dealId,
        valuation,
        parcel_number: r.apn ?? null,
        city: r.city ?? null,
        county: r.county ?? null,
        state: r.state ?? null,
        asset_class: r.asset_class ?? null,
        asset_type: r.asset_type ?? null,
        zoning_category: r.zoning_category ?? null,
        address: r.address ?? null,
      },
      netFee,
    );
    out.legs = legs.map((l) => ({ key: l.key, label: l.label, amount_usd: l.amount_usd, code: l.code }));

    if (jvAmount > 0) {
      const jvKey = `JV_${String(r.jv_partner_id ?? r.jv_partner_email ?? "PARTNER")}`;
      out.legs.unshift({
        key: jvKey,
        label: String(r.jv_partner_name ?? "JV Partner"),
        amount_usd: jvAmount,
        code: "JV_CARVE_OUT",
      });
      const { data: jvExisting } = await supabaseAdmin
        .from("internal_beneficiary_allocations")
        .select("id")
        .eq("pipeline_item_id", dealId)
        .eq("beneficiary_key", jvKey)
        .limit(1);
      if (!jvExisting || !jvExisting.length) {
        await supabaseAdmin.from("internal_beneficiary_allocations").insert({
          pipeline_item_id: dealId,
          beneficiary_key: jvKey,
          beneficiary_label: String(r.jv_partner_name ?? "JV Partner"),
          amount_usd: jvAmount,
          pct: jvPct,
          reason: `JV_CARVE_OUT · ${jvPct}% of gross assignment fee`,
          status: "CLEARED",
          dispatch_rail: "BLUEVINE",
        } as never);
      }
    }

    // Deal-level clearance flag (status enum stays Funds-Cleared).
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({ payout_status: "FEE_CLEARED" } as never)
      .eq("id", dealId);

    // Idempotent allocation rows — one per beneficiary leg per settlement ref.
    for (const l of legs) {
      const { data: existing } = await supabaseAdmin
        .from("internal_beneficiary_allocations")
        .select("id")
        .eq("pipeline_item_id", dealId)
        .eq("beneficiary_key", l.key)
        .limit(1);
      if (existing && existing.length) continue;
      await supabaseAdmin.from("internal_beneficiary_allocations").insert({
        pipeline_item_id: dealId,
        beneficiary_key: l.key,
        beneficiary_label: l.label,
        amount_usd: l.amount_usd,
        pct: l.pct,
        reason: `${l.code} · ${l.reason}`,
        status: "CLEARED",
        dispatch_rail: "BLUEVINE",
      } as never);
    }

    // Immutable success record.
    await supabaseAdmin.from("outbound_alert_log").insert({
      channel: "FEE_CLEARED",
      status: "SUCCESS",
      target: settlementRef,
      pipeline_item_id: dealId,
      payload: {
        net_fee_usd: netFee,
        settlement_reference: settlementRef,
        legs: out.legs,
      } as never,
    } as never);

    // Settlement receipt on the delivery tape + shadow escrow ledger (fail-forward).
    try {
      const { writeSettlementLedger } = await import("@/lib/midflight-reconcile.server");
      await writeSettlementLedger(r, netFee, settlementRef);
    } catch (e) {
      console.error("[fee-clearing] settlement ledger failed", e);
    }

    const { appendLedger } = await import("@/lib/event-ledger.server");
    await appendLedger({
      entity: "closing_pipeline_items",
      entityId: dealId,
      operation: "FEE_CLEARED_SPLIT",
      actor: "stripe_webhook",
      after: { net_fee_usd: netFee, settlement_reference: settlementRef, legs: out.legs },
    });

    out.ok = true;
    return out;
  } catch (e) {
    console.error("[fee-clearing] failed", e);
    return { ...out, error: e instanceof Error ? e.message : String(e) };
  }
}
