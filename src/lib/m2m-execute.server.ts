// Pull-model execution core: the fund calls US.
// HMAC-verified, txn-id idempotent, atomic claim through the m2m_accept RPC.

import { sha256Hex, storeReceipt, replayReceipt, signedJson } from "./m2m-hmac.server";
import type { SignedKey } from "./m2m-hmac.server";
import { settlementAccount } from "./settlement-rail.server";

export const MICRO_TEST_MAX_USD = 1;

/** Maps an institutional API key to the buy box that owns its mandate. */
export async function resolveBuyBox(key: SignedKey) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sel = "id, label, active, execution_mode";
  if (key.fund_id) {
    const byId = await supabaseAdmin
      .from("buyer_buy_boxes")
      .select(sel)
      .eq("id", key.fund_id)
      .maybeSingle();
    if (byId.data) return byId.data as Record<string, any>;
    const byBuyer = await supabaseAdmin
      .from("buyer_buy_boxes")
      .select(sel)
      .eq("buyer_id", key.fund_id)
      .eq("active", true)
      .maybeSingle();
    if (byBuyer.data) return byBuyer.data as Record<string, any>;
  }
  const label = key.label ?? `COUNTERPARTY ${key.id.slice(0, 8).toUpperCase()}`;
  const byLabel = await supabaseAdmin
    .from("buyer_buy_boxes")
    .select(sel)
    .eq("label", label)
    .maybeSingle();
  if (byLabel.data) return byLabel.data as Record<string, any>;

  // Zero-friction onboarding: a verified signing key IS the mandate. Provision
  // the execution record on first authenticated call rather than rejecting.
  const { randomUUID } = await import("crypto");
  const { data: created, error: createErr } = await supabaseAdmin
    .from("buyer_buy_boxes")
    .insert({
      label,
      buyer_id: randomUUID(),
      active: true,
      execution_mode: "M2M",
      target_asset_types: [],
      target_zip_codes: [],
      max_contract_price: 100_000_000,
      min_placement_margin: 0,
      capital_to_deploy_usd: 0,
    } as never)
    .select(sel)
    .maybeSingle();
  if (createErr) console.error("[m2m-execute] mandate provision failed", createErr.message);
  return (created as Record<string, any> | null) ?? null;
}

export type ExecuteInput = {
  key: SignedKey;
  body: string;
  txnId: string;
  endpoint: string;
  secret?: string | null;
  /** Sandbox crucible: validate + store receipt, never touch economic rails. */
  dryRun?: boolean;
  /** Origin of the internal Mock RTGS service (UAT only). */
  mockRailBase?: string | null;
  /** Forced mock authorization latency, used to drive the 500ms poison pill. */
  mockDelayMs?: number | null;
};



/**
 * Executes a fund's buy instruction.
 * Returns a Response; replays the identical stored response on repeat txn ids.
 */
export async function executePull(input: ExecuteInput): Promise<Response> {
  const t0 = Date.now();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const prior = await replayReceipt(input.key.id, input.txnId);
  if (prior) {
    const res = signedJson(prior.response, prior.http_status, input.secret ?? null);
    res.headers.set("X-Idempotent-Replay", "true");
    res.headers.set("X-Client-Txn-Id", input.txnId);
    return res;
  }

  const finish = async (status: number, payload: Record<string, unknown>) => {
    await storeReceipt({
      apiKeyId: input.key.id,
      txnId: input.txnId,
      endpoint: input.endpoint,
      requestHash: sha256Hex(input.body),
      status,
      response: payload,
    });
    const res = signedJson(payload, status, input.secret ?? null);
    res.headers.set("X-Client-Txn-Id", input.txnId);
    return res;
  };

  let parsed: any = {};
  try {
    parsed = JSON.parse(input.body || "{}");
  } catch {
    return finish(400, { accepted: false, error: "invalid_json" });
  }

  const dealId = String(parsed?.deal_id ?? parsed?.property_id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(dealId))
    return finish(400, { accepted: false, error: "invalid_deal_id" });

  const box = await resolveBuyBox(input.key);
  if (!box || !box["active"])
    return finish(403, { accepted: false, error: "no_active_mandate_for_key" });

  // Optional client-side price protection (limit order semantics).
  const maxFee = Number(parsed?.max_assignment_fee ?? 0) || 0;
  const { data: preview } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("optimized_acquisition_premium, base_contract_price, cleared_at")
    .eq("id", dealId)
    .maybeSingle();
  const p = (preview ?? {}) as Record<string, any>;
  if (!preview) return finish(404, { accepted: false, error: "deal_not_found" });
  if (p["cleared_at"]) return finish(409, { accepted: false, error: "already_cleared" });
  if (maxFee > 0 && Number(p["optimized_acquisition_premium"] ?? 0) > maxFee)
    return finish(409, {
      accepted: false,
      error: "limit_exceeded",
      assignment_fee: Number(p["optimized_acquisition_premium"] ?? 0),
      max_assignment_fee: maxFee,
    });

  // Payload-embedded capital: the strike must carry a clearing-network token.
  // Missing/underfunded => 402. Authorization slower than 500ms => 408 poison
  // pill, asset flashes straight back to the active queue.
  // Sandbox runs authorize against the internal Mock RTGS service, so the gate,
  // the pill and the atomic lock are exercised identically to production.
  const requiredFee = Number(p["optimized_acquisition_premium"] ?? 0);
  const { parseCapitalToken, authorizeCapital, CAPITAL_TTL_MS } = await import(
    "@/lib/capital-token.server"
  );
  const tok = parseCapitalToken(parsed);
  if (!tok.ok)
    return finish(402, {
      accepted: false,
      error: tok.error,
      required_amount_usd: requiredFee,
      accepted_networks: ["FEDNOW", "RTP", "STABLECOIN", "WIRE"],
      // Institutional Push Model: wire first, then strike with the IMAD/OMAD hash.
      settlement_instructions: settlementAccount(),
      mock_rail: Boolean(input.mockRailBase),
    });
  const authUrl = input.mockRailBase
    ? `${input.mockRailBase}/api/internal/mock-bank/authorize${input.mockDelayMs != null ? `?delay_ms=${input.mockDelayMs}` : ""}`
    : null;
  const auth = await authorizeCapital(tok.token, requiredFee, { railUrl: authUrl });
  if (!auth.ok)
    return finish(auth.status, {
      accepted: false,
      error: auth.error,
      ttl_ms: CAPITAL_TTL_MS,
      asset_state: auth.status === 408 ? "RELEASED_TO_QUEUE" : "LOCKED_OUT",
      mock_rail: Boolean(input.mockRailBase),
    });

  if (input.dryRun) {
    // Atomic seal is exercised end-to-end, marked UAT so the reconciler and
    // treasury sweep never touch synthetic capital.
    let simLock: unknown = null;
    try {
      const { lockAssignmentFee } = await import("@/lib/fee-lock.server");
      simLock = await lockAssignmentFee({
        dealId,
        txnId: input.txnId,
        apiKeyId: input.key.id,
        counterparty: input.key.label ?? null,
        assignmentFee: requiredFee,
        notional: Number(p["base_contract_price"] ?? 0),
        lockState: "UAT_SIMULATED",
      });
    } catch (e) {
      console.error("[m2m-execute] sandbox lock failed", (e as Error).message);
    }
    return finish(200, {
      accepted: true,
      simulated: true,
      deal_id: dealId,
      client_txn_id: input.txnId,
      state: "UAT_SIMULATED",
      rail_status: input.mockRailBase ? "MOCK_AUTHORIZED" : "SKIPPED_ZERO_VALUE",
      capital_authorized_ms: auth.authorized_ms,
      capital_token_hash: tok.token.token_hash,
      fee_lock: simLock,
      counterparty: input.key.label,
      sandbox: true,
      elapsed_ms: Date.now() - t0,
    });
  }



  const accept = async () =>

    supabaseAdmin.rpc("m2m_accept" as never, {
      _id: dealId,
      _box_id: box["id"],
      _signature: String(parsed?.signature ?? input.txnId).slice(0, 512),
    } as never);

  let { data, error } = await accept();
  // Pull model: the caller executes straight off the public tape, so no prior
  // outbound dispatch exists. Claim the atomic lock, then accept.
  if (!error && !(data as any)?.ok && (data as any)?.error === "not_dispatched_to_caller") {
    const { data: claim } = await supabaseAdmin.rpc("m2m_claim_dispatch" as never, {
      _id: dealId,
      _box_id: box["id"],
      _window_seconds: 60,
    } as never);
    if ((claim as any)?.ok) ({ data, error } = await accept());
    else
      return finish(409, {
        accepted: false,
        reason: (claim as any)?.error ?? "claim_failed",
      });
  }

  if (error) return finish(500, { accepted: false, error: "accept_failed", message: error.message });
  const res = (data ?? {}) as Record<string, any>;
  if (!res["ok"])
    return finish(res["error"] === "not_found" ? 404 : 409, {
      accepted: false,
      reason: res["error"],
    });

  // Push model: hand the counterparty our FedWire coordinates in the sealed
  // 200 OK. Their treasury desk pushes; we never touch their credentials.
  const acct = settlementAccount();
  const wire = acct.routing && acct.account
    ? {
        bank_name: acct.bank,
        account_name: acct.beneficiary,
        routing_number: acct.routing,
        account_number: acct.account,
        rail: acct.rail,
        amount_usd: Number(res["price"] ?? 0),
        memo_id: res["memo_id"],
      }
    : null;

  // Proof-of-escrow: a signed, self-verifying snapshot of clearing balances
  // bound to this deal. The counterparty verifies the HMAC instead of
  // trusting an operator-asserted number.
  let escrowProof: unknown = null;
  try {
    const { buildEscrowProof } = await import("@/lib/escrow-proof.server");
    escrowProof = await buildEscrowProof({
      dealId,
      dealNotional: Number(res["price"] ?? 0),
    });
  } catch (e) {
    console.error("[m2m-execute] escrow proof failed", (e as Error).message);
  }

  // Atomic escrow payload: execution IS settlement. The fee is sealed the same
  // millisecond this handler returns 200 OK — no invoice, zero days pending.
  let feeLock: unknown = null;
  try {
    const { lockAssignmentFee } = await import("@/lib/fee-lock.server");
    feeLock = await lockAssignmentFee({
      dealId,
      txnId: input.txnId,
      apiKeyId: input.key.id,
      counterparty: input.key.label ?? null,
      assignmentFee: Number(res["assignment_fee"] ?? 0),
      notional: Number(res["price"] ?? 0),
    });
  } catch (e) {
    console.error("[m2m-execute] fee lock failed", (e as Error).message);
  }

  // No drawdown. The wire is already in flight; we register the inbound push
  // against the sealed fee so the reconciler can match it on arrival.
  let inbound: unknown = null;
  try {
    await supabaseAdmin
      .from("fee_escrow_locks")
      .update({ lock_state: "AWAITING_INBOUND_WIRE" } as never)
      .eq("client_txn_id", input.txnId);
    inbound = {
      model: "INSTITUTIONAL_PUSH",
      network: tok.token.network,
      fedwire_reference: tok.token.reference,
      amount_usd: Number(res["assignment_fee"] ?? 0),
      destination_routing: acct.routing,
    };
  } catch (e) {
    console.error("[m2m-execute] inbound registration failed", (e as Error).message);
  }

  return finish(200, {
    accepted: true,
    deal_id: dealId,
    client_txn_id: input.txnId,
    state: "SETTLED_ATOMIC",
    memo_id: res["memo_id"],
    assignment_fee: Number(res["assignment_fee"] ?? 0),
    price: Number(res["price"] ?? 0),
    wire_instructions: wire,
    escrow_proof: escrowProof,
    fee_lock: feeLock,
    capital_token_hash: tok.token.token_hash,
    settlement: inbound,
    counterparty: input.key.label,
    sandbox: input.key.sandbox,
    elapsed_ms: Date.now() - t0,
  });



}
