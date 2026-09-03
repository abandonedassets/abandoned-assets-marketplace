// Truth layer for settlement claims — REAL-WORLD GATING ONLY.
//
// An asset is only "GREEN_GO_VERIFIED" when three externally-sourced records
// exist: an executed purchase agreement hash, a verified cash counterparty,
// and an active title/escrow file number. Anything else is hard-locked to
// BLOCKED and must display zero projected settlement value.
//
// No synthetic clearance, no internally-generated transfer references, no
// calendar-derived "in transit" claims.

export type BindingBlocker =
  | "NO_SIGNED_CONTRACT"
  | "NO_VERIFIED_COUNTERPARTY"
  | "NO_TITLE_ESCROW_FILE";

export type SettlementBinding = {
  /** True only when all three real-world gates are satisfied. */
  bound: boolean;
  state: "GREEN_GO_VERIFIED" | "BLOCKED_AWAITING_REAL_WORLD_DATA";
  blockers: BindingBlocker[];
};

export type GateFields = {
  signed_contract_hash?: string | null;
  verified_counterparty_id?: string | null;
  title_escrow_file_number?: string | null;
  contract_mode?: string | null;
};

const has = (v: unknown) => String(v ?? "").trim().length > 0;

/** Internally-issued (synthetic) references are never treated as real. */
const isSyntheticRef = (v: unknown) => /^INT\d{8}/i.test(String(v ?? "").trim());

export function settlementBinding(d: GateFields & Record<string, unknown>): SettlementBinding {
  const blockers: BindingBlocker[] = [];

  const isDoubleClose = String(d.contract_mode ?? "").toUpperCase() === "DOUBLE_CLOSE";
  if (!isDoubleClose && (!has(d.signed_contract_hash) || isSyntheticRef(d.signed_contract_hash)))
    blockers.push("NO_SIGNED_CONTRACT");
  if (!has(d.verified_counterparty_id)) blockers.push("NO_VERIFIED_COUNTERPARTY");
  if (!has(d.title_escrow_file_number)) blockers.push("NO_TITLE_ESCROW_FILE");

  const bound = blockers.length === 0;
  return {
    bound,
    state: bound ? "GREEN_GO_VERIFIED" : "BLOCKED_AWAITING_REAL_WORLD_DATA",
    blockers,
  };
}

export const BLOCKER_LABEL: Record<BindingBlocker, string> = {
  NO_SIGNED_CONTRACT: "no signed contract",
  NO_VERIFIED_COUNTERPARTY: "no verified buyer",
  NO_TITLE_ESCROW_FILE: "no title/escrow file",
};
