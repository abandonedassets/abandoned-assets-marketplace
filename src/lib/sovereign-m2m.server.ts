// Sovereign M2M primitives — no third-party title/escrow SaaS in the loop.
//  1. Signature-hash state trigger  (local SHA-256 -> DB -> daemon unblock)
//  2. Cryptographic fee lock        (X-Fee-Ack enforcement, else drop + cascade)
//  3. Deterministic sequencer       (microsecond stamp, first wins, 409 to rest)
//  4. Dark-pool conditional reserve (GREY_POOL flag on PENDING-UNDERWRITING)
//
// Fail-forward: every helper swallows its own errors and never stalls a deal.
import { createHash, createHmac } from "crypto";

export const GREY_POOL_STATUSES = [
  "Pending-Underwriting",
  "Auto-Enrichment-Pending",
  "Under-Review",
  "New",
];

function feeSecret() {
  return (
    process.env["M2M_SEAL_SECRET"] ??
    process.env["M2M_SIGNING_SECRET"] ??
    process.env["CLAIM_HASH_SECRET"] ??
    "aa-sovereign-fee-lock"
  );
}

/** Locked equation: contract_price + clearing_fee = total_wire_instruction. */
export function feeLock(dealId: string, price: number, fee: number) {
  const total = Number((price + fee).toFixed(2));
  const equation = `${dealId}|${price.toFixed(2)}+${fee.toFixed(2)}=${total.toFixed(2)}`;
  return {
    contract_price: Number(price.toFixed(2)),
    clearing_fee: Number(fee.toFixed(2)),
    total_wire_instruction: total,
    equation,
    fee_ack_hash: createHmac("sha256", feeSecret()).update(equation).digest("hex"),
  };
}

/** Constant-time-ish compare of the buyer's X-Fee-Ack against our lock. */
export function verifyFeeAck(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = provided.trim().toLowerCase().replace(/^sha256=/, "");
  const b = expected.toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Local SHA-256 of the executed signature blob — no external title service. */
export function signatureHash(input: {
  dealId: string;
  signerEmail?: string | null;
  signedAt?: string | null;
  documentRef?: string | null;
}) {
  return createHash("sha256")
    .update(
      [
        input.dealId,
        input.signerEmail ?? "",
        input.signedAt ?? new Date().toISOString(),
        input.documentRef ?? "",
      ].join("|"),
    )
    .digest("hex");
}

/**
 * Injects the signature hash and strips the blocked/pending state in the same
 * write, so the dispatch daemon sees an executable asset on its next tick.
 */
export async function injectSignatureHash(input: {
  dealId: string;
  signerEmail?: string | null;
  signedAt?: string | null;
  documentRef?: string | null;
  hash?: string;
}) {
  try {
    const hash = input.hash ?? signatureHash(input);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("sovereign_signature_unblock" as never, {
      _deal_id: input.dealId,
      _hash: hash,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true as const, hash, result: data as unknown };
  } catch (e) {
    console.error("[sovereign] signature inject failed", e);
    return { ok: false as const, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Microsecond-resolution monotonic stamp for the collision sequencer. */
export function stampMicros(): number {
  return Math.round(Date.now() * 1000 + (performance.now() % 1) * 1000);
}

export type ClaimResult = {
  ok: boolean;
  status: number;
  error?: string;
  reservation_id?: string;
  mode?: string;
  stamp_micros?: number;
  winner_ref?: string;
};

/**
 * Deterministic state sequencer. First inbound acceptance packet locks the
 * asset; every slower machine gets 409 ASSET_CLEARED plus the next asset.
 */
export async function sequencerClaim(input: {
  dealId: string;
  buyerRef: string;
  mode?: "FIRM" | "CONDITIONAL";
  feeAckHash?: string | null;
  capitalUsd?: number | null;
}): Promise<ClaimResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("sovereign_claim" as never, {
      _deal_id: input.dealId,
      _buyer_ref: input.buyerRef,
      _stamp_micros: stampMicros(),
      _mode: input.mode ?? "FIRM",
      _fee_ack_hash: input.feeAckHash ?? null,
      _capital: input.capitalUsd ?? null,
    } as never);
    if (error) throw new Error(error.message);
    return (data ?? { ok: false, status: 500, error: "no_result" }) as ClaimResult;
  } catch (e) {
    console.error("[sovereign] claim failed", e);
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Next executable asset handed to machines that lost the race. */
export async function nextAvailableAsset(excludeDealId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id, zip, state, asset_type, base_contract_price, optimized_acquisition_premium")
      .is("cleared_at", null)
      .is("locked_at", null)
      .neq("id", excludeDealId)
      .order("optimized_acquisition_premium", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const d = data as Record<string, unknown>;
    const lock = feeLock(
      String(d["id"]),
      Number(d["base_contract_price"] ?? 0),
      Number(d["optimized_acquisition_premium"] ?? 0),
    );
    return { deal_id: String(d["id"]), zip: d["zip"] ?? null, fee_lock: lock };
  } catch (e) {
    console.error("[sovereign] next asset lookup failed", e);
    return null;
  }
}

/** GREY_POOL flag: conditional reserve allowed before the signature lands. */
export function greyPoolFlag(status: string | null | undefined, signedHash: string | null) {
  const grey = !signedHash && GREY_POOL_STATUSES.includes(String(status ?? ""));
  return {
    grey_pool: grey,
    reserve_mode: grey ? "CONDITIONAL" : "FIRM",
    reserve_endpoint: "/api/m2m/reserve",
    note: grey
      ? "Asset is pre-signature. Lock capital conditionally; the reserve arms automatically the millisecond the seller signature hash hits the ledger."
      : null,
  };
}
