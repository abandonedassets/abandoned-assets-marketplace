// Live contract state machine:
// UNSENT -> PENDING_SELLER_SIGN -> SELLER_SIGNED -> PENDING_BUYER_SIGN -> FULLY_EXECUTED
// Plus terminal settlement flags EMD_CLEARED / VOID.
export const CONTRACT_STATES = [
  "UNSENT",
  "PENDING_SELLER_SIGN",
  "SELLER_SIGNED",
  "PENDING_BUYER_SIGN",
  "FULLY_EXECUTED",
  "EMD_CLEARED",
  "VOID",
] as const;

export type ContractState = (typeof CONTRACT_STATES)[number];

const ORDER: Record<ContractState, number> = {
  UNSENT: 0,
  PENDING_SELLER_SIGN: 1,
  SELLER_SIGNED: 2,
  PENDING_BUYER_SIGN: 3,
  FULLY_EXECUTED: 4,
  EMD_CLEARED: 5,
  VOID: 99,
};

export function isContractState(v: unknown): v is ContractState {
  return typeof v === "string" && (CONTRACT_STATES as readonly string[]).includes(v);
}

/** Monotonic advance (never regresses) — fail-forward, never throws. */
export async function setContractState(dealId: string, next: ContractState) {
  try {
    if (!dealId) return { ok: false as const, reason: "no_deal" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id, contract_state")
      .eq("id", dealId)
      .maybeSingle();
    if (!row) return { ok: false as const, reason: "deal_not_found" };
    const current = (row as any).contract_state as ContractState | null;
    if (next !== "VOID" && current && ORDER[current] >= ORDER[next]) {
      return { ok: true as const, state: current, skipped: true };
    }
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({ contract_state: next } as never)
      .eq("id", dealId);
    return { ok: true as const, state: next, skipped: false };
  } catch (e) {
    console.error("[contract-state] failed", e);
    return { ok: false as const, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Map an external e-sign provider event to a contract state. */
export function mapEsignEvent(event: string): ContractState | null {
  const e = event.toLowerCase();
  if (e.includes("void") || e.includes("declin") || e.includes("cancel")) return "VOID";
  if (e.includes("complete") || e.includes("executed") || e.includes("all_signed"))
    return "FULLY_EXECUTED";
  if (e.includes("buyer") && e.includes("sign")) return "FULLY_EXECUTED";
  if (e.includes("seller") && e.includes("sign")) return "SELLER_SIGNED";
  if (e.includes("buyer") && e.includes("sent")) return "PENDING_BUYER_SIGN";
  if (e.includes("sent") || e.includes("delivered")) return "PENDING_SELLER_SIGN";
  return null;
}
