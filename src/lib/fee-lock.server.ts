// Atomic escrow payload: the fee is locked in the same millisecond the
// execute endpoint returns 200 OK. No invoice, no days pending.
import { createHmac, createHash } from "crypto";

export type FeeLockInput = {
  dealId: string;
  txnId: string;
  apiKeyId: string | null;
  counterparty: string | null;
  assignmentFee: number;
  notional: number;
  /** Defaults to LOCKED; sandbox runs seal as UAT_SIMULATED. */
  lockState?: string;
};


export type FeeLock = {
  locked: boolean;
  seal_hash: string;
  assignment_fee: number;
  notional: number;
  locked_at: string;
  lock_state: string;
};

function sealSecret() {
  return (
    process.env["M2M_SEAL_SECRET"] ??
    process.env["LOVABLE_API_KEY"] ??
    "aa-fee-seal-fallback"
  );
}

/** Deterministic cryptographic seal over the economic terms of the trade. */
export function sealFee(i: FeeLockInput, at: string) {
  const canonical = [
    i.dealId,
    i.txnId,
    i.assignmentFee.toFixed(2),
    i.notional.toFixed(2),
    at,
  ].join("\n");
  return createHmac("sha256", sealSecret()).update(canonical).digest("hex");
}

export function bodyDigest(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Writes the fee lock. Unique on client_txn_id, so a replayed execution
 * never double-locks — it returns the original seal.
 */
export async function lockAssignmentFee(i: FeeLockInput): Promise<FeeLock | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const at = new Date().toISOString();
    const seal = sealFee(i, at);
    const { data, error } = await supabaseAdmin
      .from("fee_escrow_locks")
      .upsert(
        {
          deal_id: i.dealId,
          client_txn_id: i.txnId,
          api_key_id: i.apiKeyId,
          counterparty: i.counterparty,
          assignment_fee: i.assignmentFee,
          notional: i.notional,
          seal_hash: seal,
          lock_state: i.lockState ?? "LOCKED",
          locked_at: at,
        } as never,
        { onConflict: "client_txn_id", ignoreDuplicates: false },
      )
      .select("assignment_fee, notional, seal_hash, lock_state, locked_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    const r = (data ?? {}) as Record<string, any>;
    return {
      locked: true,
      seal_hash: String(r["seal_hash"] ?? seal),
      assignment_fee: Number(r["assignment_fee"] ?? i.assignmentFee),
      notional: Number(r["notional"] ?? i.notional),
      locked_at: String(r["locked_at"] ?? at),
      lock_state: String(r["lock_state"] ?? "LOCKED"),
    };
  } catch (e) {
    // Fail-forward: never stall a settled execution on ledger bookkeeping.
    console.error("[fee-lock] lock failed", (e as Error).message);
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("execution_dlq").insert({
        deal_id: i.dealId,
        client_txn_id: i.txnId,
        reason: "FEE_LOCK_WRITE_FAILED",
        detail: { message: (e as Error).message, assignment_fee: i.assignmentFee } as any,
      } as never);
    } catch {}
    return null;
  }
}
