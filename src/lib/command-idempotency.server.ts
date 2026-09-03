// Deterministic database-level idempotency.
//
// The edge layer can be raced: duplicate webhooks, cron overlap, retries after a
// timeout. `processed_commands` has a UNIQUE constraint on execution_key, so the
// database itself — not application logic — rejects the second execution.

import { createHash } from "crypto";

/**
 * Stable SHA-256 execution key derived from the command's semantic identity,
 * salted with a server-only secret so external event IDs (e.g. Stripe event.id)
 * cannot be used to pre-compute or spoof idempotency keys.
 */
export function executionKey(parts: Array<string | number | null | undefined>): string {
  const salt =
    process.env["IDEMPOTENCY_SALT"] ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    "unsalted-local-dev";
  return createHash("sha256")
    .update(`${salt}::${parts.map((p) => String(p ?? "")).join("|")}`)
    .digest("hex");
}

export type ClaimResult = {
  claimed: boolean;
  commandId: string | null;
  firstSeenAt: string | null;
  priorStatus: string | null;
};

/** Atomically claim a command. `claimed === false` means it already ran — skip. */
export async function claimCommand(input: {
  key: string;
  type?: string;
  source?: string | null;
  dealId?: string | null;
  payloadHash?: string | null;
}): Promise<ClaimResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("claim_command" as never, {
    _execution_key: input.key,
    _command_type: input.type ?? "generic",
    _source: input.source ?? null,
    _deal_id: input.dealId ?? null,
    _payload_hash: input.payloadHash ?? null,
  } as never);

  if (error) {
    // Fail-forward: never stall the pipeline on the guard itself.
    console.error("[idempotency] claim failed", error.message);
    return { claimed: true, commandId: null, firstSeenAt: null, priorStatus: null };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { claimed: boolean; command_id: string; first_seen_at: string; prior_status: string | null }
    | undefined;

  return {
    claimed: row?.claimed ?? true,
    commandId: row?.command_id ?? null,
    firstSeenAt: row?.first_seen_at ?? null,
    priorStatus: row?.prior_status ?? null,
  };
}

/** Record the terminal outcome of a claimed command. Never throws. */
export async function completeCommand(
  key: string,
  status: "COMPLETED" | "FAILED" | string,
  result?: Record<string, unknown>,
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.rpc("complete_command" as never, {
      _execution_key: key,
      _status: status,
      _result: (result ?? null) as never,
    } as never);
  } catch (e) {
    console.error("[idempotency] complete failed", e);
  }
}

/**
 * Run `fn` exactly once per execution key across all workers and retries.
 * Returns `{ skipped: true }` when another execution already claimed the key.
 */
export async function runOnce<T>(
  input: {
    key: string;
    type?: string;
    source?: string | null;
    dealId?: string | null;
    payloadHash?: string | null;
  },
  fn: () => Promise<T>,
): Promise<{ skipped: true; firstSeenAt: string | null } | { skipped: false; value: T }> {
  const claim = await claimCommand(input);
  if (!claim.claimed) return { skipped: true, firstSeenAt: claim.firstSeenAt };

  try {
    const value = await fn();
    await completeCommand(input.key, "COMPLETED", { ok: true });
    return { skipped: false, value };
  } catch (e) {
    await completeCommand(input.key, "FAILED", {
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
