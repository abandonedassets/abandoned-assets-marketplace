// Headless M2M (machine-to-machine) execution layer.
// Institutional algorithms POST a signed acceptance payload against a live
// VDR token inside the Time-in-Force window. No human interaction: contract
// executes, Bluevine debits the assignment fee/EMD via ACH, asset clears.

import { createHash } from "crypto";

export const TIF_WINDOW_MS = 60_000;

export type M2MResult =
  | {
      ok: true;
      deal_id: string;
      payment_intent: string | null;
      amount_usd: number;
      latency_ms: number;
      status: "Cleared";
    }
  | { ok: false; status: number; error: string; detail?: string };

export function hashApiKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

/** Verifies key, enforces per-minute rate limit. */
export async function authorizeInstitutionalKey(bearer: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: key, error } = await Promise.race([
    supabaseAdmin
      .from("institutional_api_keys")
      .select("id, is_active, label, rate_limit_per_minute, sandbox")
      .eq("key_hash", hashApiKey(bearer))
      .maybeSingle(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Database timeout")), 5000))
  ]) as any;

  if (error || !key) return { ok: false as const, status: error?.message === "Database timeout" ? 503 : 403, error: "unauthorized" };
  if (!key.is_active) return { ok: false as const, status: 403, error: "revoked" };
  if (key.sandbox) return { ok: false as const, status: 403, error: "sandbox_restricted", detail: "This key is UAT-only" };

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabaseAdmin
    .from("institutional_api_request_log")
    .select("id", { count: "exact", head: true })
    .eq("api_key_id", key.id)
    .gte("requested_at", since);
  if ((count ?? 0) >= (key.rate_limit_per_minute ?? 60))
    return { ok: false as const, status: 429, error: "rate_limited" };

  return { ok: true as const, key };
}

async function logRequest(apiKeyId: string | null, httpStatus: number) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("institutional_api_request_log").insert({
      api_key_id: apiKeyId,
      endpoint: "/api/m2m/execute",
      http_status: httpStatus,
    } as never);
  } catch (e) {
    console.error("[m2m] request log failed", e);
  }
}

async function chargeOffSession(input: {
  customerId: string;
  amountUsd: number;
  dealId: string;
  idempotencyKey: string;
}) {
  const { issueAchDebit } = await import("./bluevine-rails.server");
  const rail = await issueAchDebit({
    dealId: input.dealId,
    amountUsd: input.amountUsd,
    memo: `M2M assignment fee \u2014 ${input.dealId}`,
    counterpartyRef: input.customerId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!rail.ok) return { ok: false as const, error: rail.error };
  return { ok: true as const, id: rail.id, status: rail.status };
}

export async function executeM2M(input: {
  bearer: string;
  vdrToken: string;
  signatureHash: string;
  stripeCustomerId: string;
  buyerReference?: string | null;
}): Promise<M2MResult> {
  const t0 = Date.now();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const auth = await authorizeInstitutionalKey(input.bearer);
  if (!auth.ok) {
    await logRequest(null, auth.status);
    return { ok: false, status: auth.status, error: auth.error };
  }
  const apiKeyId = auth.key.id;

  const { resolveVdrToken } = await import("./vdr.server");
  const dealId = await resolveVdrToken(input.vdrToken);
  if (!dealId) {
    await logRequest(apiKeyId, 404);
    return { ok: false, status: 404, error: "invalid_vdr_token" };
  }

  const { data: deal } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id, status, zip, base_contract_price, optimized_acquisition_premium, tif_expires_at, tif_state, cleared_at",
    )
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) {
    await logRequest(apiKeyId, 404);
    return { ok: false, status: 404, error: "deal_not_found" };
  }

  const d = deal as Record<string, any>;
  if (d.cleared_at || d.tif_state === "Executed") {
    await logRequest(apiKeyId, 409);
    return { ok: false, status: 409, error: "already_executed" };
  }

  const expires = d.tif_expires_at ? new Date(d.tif_expires_at).getTime() : 0;
  const remaining = expires - Date.now();
  if (!expires || remaining <= 0) {
    await supabaseAdmin.from("m2m_executions").insert({
      pipeline_item_id: dealId,
      api_key_id: apiKeyId,
      buyer_reference: input.buyerReference ?? auth.key.label,
      vdr_token: input.vdrToken.slice(0, 80),
      signature_hash: input.signatureHash.slice(0, 128),
      stripe_customer_id: input.stripeCustomerId,
      status: "TIF_Expired",
      latency_ms: Date.now() - t0,
      tif_remaining_ms: 0,
      error_text: "execution window lapsed",
    } as never);
    await logRequest(apiKeyId, 410);
    return { ok: false, status: 410, error: "tif_expired" };
  }

  const amount = Number(d.optimized_acquisition_premium) || 0;
  if (amount <= 0) {
    await logRequest(apiKeyId, 422);
    return { ok: false, status: 422, error: "no_assignment_fee" };
  }

  const charge = await chargeOffSession({
    customerId: input.stripeCustomerId,
    amountUsd: amount,
    dealId,
    idempotencyKey: `m2m_${dealId}_${input.signatureHash.slice(0, 24)}`,
  });

  if (!charge.ok) {
    await supabaseAdmin.from("m2m_executions").insert({
      pipeline_item_id: dealId,
      api_key_id: apiKeyId,
      buyer_reference: input.buyerReference ?? auth.key.label,
      vdr_token: input.vdrToken.slice(0, 80),
      signature_hash: input.signatureHash.slice(0, 128),
      stripe_customer_id: input.stripeCustomerId,
      amount_usd: amount,
      status: "Charge_Failed",
      latency_ms: Date.now() - t0,
      tif_remaining_ms: remaining,
      error_text: charge.error.slice(0, 400),
    } as never);
    await logRequest(apiKeyId, 402);
    return { ok: false, status: 402, error: "charge_failed", detail: charge.error };
  }

  const nowIso = new Date().toISOString();
  // The state machine only allows legal transitions; walk the deal through the
  // permitted path instead of jumping straight to Funds-Cleared.
  const step = async (patch: Record<string, unknown>) => {
    const { error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .update(patch as never)
      .eq("id", dealId);
    if (error) console.error("[m2m] state step failed", patch["status"], error.message);
  };

  const current = String(d.status ?? "");
  if (current === "Scout") {
    // A funded algorithmic acceptance is the strongest possible confidence
    // signal — promote the Scout row out of the holding lane.
    await step({ confidence_score: 95, manual_review: false, status: "New" });
  } else if (current === "Webhook_Dispatched") {
    await step({ status: "New" });
  }

  if (current !== "Locked-Escrow-Pending") await step({ status: "Locked-Escrow-Pending" });
  await step({
    status: "Funds-Cleared",
    escrow_status: "CLEARED",
    cleared_at: nowIso,
    cleared_amount: amount,
    active_owner: amount >= 100000 ? "Master" : "Master",
    tif_state: "Executed",
    tif_expires_at: null,
    stripe_session_id: charge.id,
  });


  const latency = Date.now() - t0;
  await supabaseAdmin.from("m2m_executions").insert({
    pipeline_item_id: dealId,
    api_key_id: apiKeyId,
    buyer_reference: input.buyerReference ?? auth.key.label,
    vdr_token: input.vdrToken.slice(0, 80),
    signature_hash: input.signatureHash.slice(0, 128),
    stripe_customer_id: input.stripeCustomerId,
    stripe_payment_intent_id: charge.id,
    amount_usd: amount,
    status: "Cleared",
    latency_ms: latency,
    tif_remaining_ms: remaining,
  } as never);

  await supabaseAdmin
    .from("system_audit_logs")
    .insert({
      pipeline_item_id: dealId,
      event_type: "M2M_EXECUTION",
      reason: `Headless execution by ${auth.key.label} in ${latency}ms`,
      payload: {
        payment_intent: charge.id,
        amount_usd: amount,
        signature_hash: input.signatureHash,
        tif_remaining_ms: remaining,
      } as never,
    } as never)
    .then(undefined, () => {});

  await logRequest(apiKeyId, 200);

  return {
    ok: true,
    deal_id: dealId,
    payment_intent: charge.id,
    amount_usd: amount,
    latency_ms: latency,
    status: "Cleared",
  };
}
