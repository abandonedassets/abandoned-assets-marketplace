// Programmatic M2M lock — institutional buyer algorithms bind a deal in one
// authenticated round trip: EMD authorization → pre-binding MPC execution →
// title order → signed contract payload returned inline. Zero human touch.

import { createHash, randomUUID } from "crypto";

export const EMD_LOCK_USD = 1000;

export type LockResult =
  | {
      ok: true;
      deal_id: string;
      emd: { status: "authorized"; amount_usd: number; payment_intent: string };
      contract: Record<string, unknown>;
      contract_hash: string;
      title_order: unknown;
      pre_binding: unknown;
      settlement_timestamp: string;
      latency_ms: number;
    }
  | { ok: false; status: number; error: string; detail?: string };

async function authorizeEmd(input: {
  paymentMethodId: string;
  customerId?: string | null;
  dealId: string;
  amountUsd: number;
}) {
  const { issueAchDebit } = await import("./bluevine-rails.server");
  const rail = await issueAchDebit({
    dealId: input.dealId,
    amountUsd: input.amountUsd,
    memo: `Programmatic EMD hold \u2014 ${input.dealId}`,
    counterpartyRef: input.paymentMethodId,
    idempotencyKey: `emdlock_${input.dealId}_${input.paymentMethodId}`,
  });
  if (!rail.ok) return { ok: false as const, error: rail.error };
  return { ok: true as const, id: rail.id, status: rail.status };
}

export async function programmaticLock(input: {
  bearer: string;
  dealId: string;
  paymentMethodId: string;
  stripeCustomerId?: string | null;
  buyerEmail?: string | null;
  buyerReference?: string | null;
  probe?: boolean;
}): Promise<LockResult> {
  const t0 = Date.now();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { authorizeInstitutionalKey } = await import("./m2m.server");

  const auth = await authorizeInstitutionalKey(input.bearer);
  if (!auth.ok) return { ok: false, status: auth.status, error: auth.error };

  const { data: deal } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id,status,address,city,state,zip,county,apn,asset_type,acreage,timber_density_score,estimated_stumpage_mbf,base_contract_price,optimized_acquisition_premium,lien_total,cleared_at,is_1031_candidate,qi_entity,exchange_deadline_at,title_ordered_at,contract_structure,buyer_tier_stage,assessed_value,sqft,title_status,requires_legal_review,owner_entity,owner_acquired_at,enrichment_tags,annual_property_tax,env_status,env_flag_reason",
    )
    .eq("id", input.dealId)
    .maybeSingle();
  if (!deal) return { ok: false, status: 404, error: "deal_not_found" };
  const d = deal as any;
  if (d.cleared_at) return { ok: false, status: 409, error: "already_cleared" };

  // --- 1) Bind or reuse the machine e-sign record for this deal ---
  let { data: req } = await supabaseAdmin
    .from("esign_requests")
    .select("id, token, emd_hold_status, emd_hold_ref, buyer_email")
    .eq("pipeline_item_id", input.dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!req) {
    const token = `${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const { data: created, error } = await supabaseAdmin
      .from("esign_requests")
      .insert({
        pipeline_item_id: input.dealId,
        buyer_email: input.buyerEmail ?? `m2m+${auth.key.id}@asset-weaver-30.lovable.app`,
        token,
        status: "Sent",
        assignment_fee: Number(d.optimized_acquisition_premium ?? 0),
        emd_hold_amount: EMD_LOCK_USD,
        emd_hold_status: "pending",
      } as never)
      .select("id, token, emd_hold_status, emd_hold_ref, buyer_email")
      .maybeSingle();
    if (error || !created)
      return { ok: false, status: 500, error: "esign_init_failed", detail: error?.message };
    req = created as any;
  }
  const esign = req as any;

  // --- 2) Programmatic EMD authorization (idempotent) ---
  let paymentIntent = esign.emd_hold_ref as string | null;
  if (esign.emd_hold_status !== "authorized") {
    const charge = input.probe
      ? ({ ok: true as const, id: "pi_e2e_mock_emd_hold", status: "requires_capture" })
      : await authorizeEmd({
      paymentMethodId: input.paymentMethodId,
      customerId: input.stripeCustomerId ?? null,
      dealId: input.dealId,
      amountUsd: EMD_LOCK_USD,
    });
    if (!charge.ok)
      return { ok: false, status: 402, error: "emd_authorization_failed", detail: charge.error };
    paymentIntent = charge.id;

    await supabaseAdmin
      .from("esign_requests")
      .update({
        emd_hold_status: "authorized",
        emd_hold_ref: charge.id,
        emd_hold_amount: EMD_LOCK_USD,
        emd_hold_authorized_at: new Date().toISOString(),
      } as never)
      .eq("id", esign.id);
  }

  // --- 3) Pre-binding MPC auto-execution (fail-forward) ---
  let preBinding: unknown = { executed: false, reason: "skipped" };
  try {
    const { executePreBinding } = await import("./pre-binding.server");
    preBinding = await executePreBinding({
      id: d.id,
      zip: d.zip,
      asset_type: d.asset_type,
      base_contract_price: d.base_contract_price,
      optimized_acquisition_premium: d.optimized_acquisition_premium,
    });
  } catch (e) {
    console.error("[programmatic-lock] pre-binding failed", e);
  }

  // --- 4) Title order (idempotent inside orderTitle) ---
  let titleOrder: unknown = { ordered: false, reason: "skipped" };
  try {
    const { orderTitle } = await import("./title-order.server");
    titleOrder = await orderTitle(d.id, "PRE_BINDING_MPC");
  } catch (e) {
    console.error("[programmatic-lock] title order failed", e);
  }

  const settlementTimestamp = new Date().toISOString();
  const price = Number(d.base_contract_price ?? 0);
  const fee = Number(d.optimized_acquisition_premium ?? 0);
  const liens = Number(d.lien_total ?? 0);

  const { resolveContractMode, contractTerms, estimateValuation } = await import(
    "./institutional.server"
  );
  const contractMode = resolveContractMode({
    buyerTier: d.buyer_tier_stage,
    contractStructure: d.contract_structure,
    assetType: d.asset_type,
  });
  const valuation = estimateValuation(d);

  const contract = {
    contract_version: "MPC-A2B-1.0",
    contract_mode: contractMode,
    deal_id: d.id,
    executed_at: settlementTimestamp,
    buyer_reference: input.buyerReference ?? auth.key.label,
    esign_token: esign.token,
    property: {
      address: d.address,
      city: d.city,
      state: d.state,
      zip: d.zip,
      county: d.county,
      apn: d.apn,
      asset_type: d.asset_type,
      acreage: d.acreage,
      timber_density_score: d.timber_density_score,
      estimated_stumpage_mbf: d.estimated_stumpage_mbf,
    },
    algorithmic_trust: (await import("./trust-metrics.server")).buildTrustMetrics(d),
    underwriting: {
      arv: valuation.arv,
      est_rehab: valuation.est_rehab,
      arv_discount_ratio: valuation.arv_discount_ratio,
      institutional_ready: valuation.institutional_ready,
    },
    economics: {
      contract_price: price,
      assignment_fee: fee,
      recorded_liens: liens,
      lien_subtracted_net: Math.max(0, price - liens),
      total_acquisition_cost: price + fee,
      emd_hold_usd: EMD_LOCK_USD,
    },
    exchange_1031: d.is_1031_candidate
      ? { qi_entity: d.qi_entity, identification_deadline: d.exchange_deadline_at }
      : null,
    terms: {
      ...contractTerms(contractMode, fee),
      emd_non_refundable: true,
      anti_circumvention_penalty_usd: 25000,
    },
  };

  const contractHash = createHash("sha256").update(JSON.stringify(contract)).digest("hex");

  await supabaseAdmin
    .from("system_audit_logs")
    .insert({
      pipeline_item_id: d.id,
      event_type: "PROGRAMMATIC_LOCK",
      reason: `M2M programmatic lock by ${auth.key.label}`,
      payload: {
        contract_hash: contractHash,
        payment_intent: paymentIntent,
        pre_binding: preBinding,
        title_order: titleOrder,
      } as never,
    } as never)
    .then(undefined, () => {});

  return {
    ok: true,
    deal_id: d.id,
    emd: { status: "authorized", amount_usd: EMD_LOCK_USD, payment_intent: paymentIntent! },
    contract,
    contract_hash: contractHash,
    title_order: titleOrder,
    pre_binding: preBinding,
    settlement_timestamp: settlementTimestamp,
    latency_ms: Date.now() - t0,
  };
}
