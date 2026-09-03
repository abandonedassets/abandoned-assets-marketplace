// Internal Clearance Engine — PERMANENTLY DISABLED.
//
// This module previously auto-cleared titles with a heuristic and stamped
// internally-generated, IMAD-shaped transfer references. That produced
// synthetic "bank-bound" state that was not backed by any external record.
//
// Real-world gating now governs settlement display: an asset must carry a
// signed_contract_hash, a verified_counterparty_id and a
// title_escrow_file_number sourced from outside this system.

export type ClearanceReport = {
  disabled: true;
  reason: string;
  scanned: 0;
  title_insured: 0;
  escrow_opened: 0;
  bank_bound: 0;
  errors: 0;
};

export async function runInternalClearance(_limit = 500): Promise<ClearanceReport> {
  return {
    disabled: true,
    reason:
      "Synthetic clearance is permanently disabled. Assets clear only with external contract, counterparty and title/escrow records.",
    scanned: 0,
    title_insured: 0,
    escrow_opened: 0,
    bank_bound: 0,
    errors: 0,
  };
}
