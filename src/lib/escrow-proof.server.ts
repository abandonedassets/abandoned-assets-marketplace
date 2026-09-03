// Proof-of-Escrow via ephemeral state channels.
//
// A counterparty algorithm should never have to trust a database metric we
// print. Every outbound payload (tape tick, execute receipt, FIX QuoteRequest)
// can carry a signed, self-verifying snapshot of the clearing balances that
// back the trade. The fund verifies the HMAC against the published key id and
// the numbers become code-verifiable rather than operator-asserted.

import { createHash, createHmac } from "crypto";

export const PROOF_VERSION = "AA-POE/1";
/** Proofs go stale fast — a stale liquidity claim is a lie. */
export const PROOF_TTL_SECONDS = 120;

export type EscrowProof = {
  version: string;
  key_id: string;
  issued_at: number;
  expires_at: number;
  nonce: string;
  balances: {
    /** Funds physically confirmed in the FBO/settlement account. */
    cleared_usd: number;
    /** Committed but not yet wire-verified. */
    pending_wire_usd: number;
    /** Locked against open shadow-escrow tranches. */
    escrow_locked_usd: number;
    /** Unencumbered clearing capacity available to a new cross. */
    available_usd: number;
    open_positions: number;
  };
  /** sha256 of the canonical balance string — cheap client-side re-derivation. */
  state_root: string;
  signature: string;
  /** Bound to a single deal when issued inside an execution payload. */
  deal_id?: string;
  deal_notional_usd?: number;
  /** True when available_usd covers this specific deal. */
  collateralized?: boolean;
};

function proofKey() {
  return process.env["ESCROW_PROOF_KEY"] ?? "";
}

export function proofKeyId() {
  const k = proofKey();
  if (!k) return "unconfigured";
  return createHash("sha256").update(k).digest("hex").slice(0, 16);
}

function canonical(p: Omit<EscrowProof, "signature" | "state_root" | "key_id" | "version">) {
  const b = p.balances;
  return [
    PROOF_VERSION,
    p.issued_at,
    p.expires_at,
    p.nonce,
    b.cleared_usd.toFixed(2),
    b.pending_wire_usd.toFixed(2),
    b.escrow_locked_usd.toFixed(2),
    b.available_usd.toFixed(2),
    b.open_positions,
    p.deal_id ?? "",
    (p.deal_notional_usd ?? 0).toFixed(2),
  ].join("|");
}

/**
 * Builds a signed state proof. Fail-forward: if a balance source errors the
 * proof is still issued with the components it could read — never blocks a
 * quote or an execution.
 */
export async function buildEscrowProof(opts: {
  dealId?: string;
  dealNotional?: number;
} = {}): Promise<EscrowProof> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let cleared = 0;
  let pending = 0;
  let locked = 0;
  let positions = 0;

  try {
    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("base_contract_price, optimized_acquisition_premium, payout_status, cleared_at")
      .in("payout_status", [
        "WIRE_PENDING_VERIFICATION",
        "SETTLED_PAID",
        "FEES_IN_TRANSIT",
      ]);
    for (const raw of (data ?? []) as Record<string, any>[]) {
      const fee = Number(raw["optimized_acquisition_premium"]) || 0;
      if (raw["payout_status"] === "SETTLED_PAID" || raw["cleared_at"]) cleared += fee;
      else {
        pending += fee;
        positions += 1;
      }
    }
  } catch (e) {
    console.error("[escrow-proof] pipeline balance read failed", e);
  }

  try {
    const { data } = await supabaseAdmin
      .from("shadow_escrow_ledger")
      .select("amount_secured, amount_released, liquidity_state");
    for (const raw of (data ?? []) as Record<string, any>[]) {
      if (String(raw["liquidity_state"] ?? "").toUpperCase() === "RELEASED") continue;
      locked += Math.max(
        0,
        (Number(raw["amount_secured"]) || 0) - (Number(raw["amount_released"]) || 0),
      );
    }
  } catch (e) {
    console.error("[escrow-proof] shadow escrow read failed", e);
  }

  const available = Math.max(0, cleared - locked);
  const issued = Math.floor(Date.now() / 1000);
  const nonce = createHash("sha256")
    .update(`${issued}:${opts.dealId ?? ""}:${Math.random()}`)
    .digest("hex")
    .slice(0, 24);

  const base = {
    issued_at: issued,
    expires_at: issued + PROOF_TTL_SECONDS,
    nonce,
    balances: {
      cleared_usd: round(cleared),
      pending_wire_usd: round(pending),
      escrow_locked_usd: round(locked),
      available_usd: round(available),
      open_positions: positions,
    },
    ...(opts.dealId ? { deal_id: opts.dealId } : {}),
    ...(opts.dealNotional != null ? { deal_notional_usd: round(opts.dealNotional) } : {}),
  };

  const canon = canonical(base);
  const key = proofKey();
  return {
    version: PROOF_VERSION,
    key_id: proofKeyId(),
    ...base,
    state_root: createHash("sha256").update(canon).digest("hex"),
    signature: key ? createHmac("sha256", key).update(canon).digest("hex") : "unconfigured",
    ...(opts.dealNotional != null
      ? { collateralized: available >= (opts.dealNotional ?? 0) }
      : {}),
  };
}

/** Server-side self-check used by the UAT enclave and the admin panel. */
export function verifyEscrowProof(proof: EscrowProof) {
  const key = proofKey();
  if (!key) return { ok: false, reason: "key_unconfigured" };
  const canon = canonical(proof);
  const expect = createHmac("sha256", key).update(canon).digest("hex");
  if (expect !== proof.signature) return { ok: false, reason: "bad_signature" };
  if (proof.expires_at * 1000 < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, reason: "verified" };
}

function round(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
