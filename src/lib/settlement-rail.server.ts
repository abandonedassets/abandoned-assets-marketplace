// Institutional Push Model.
// We never pull capital. The counterparty's treasury desk pushes fiat to our
// routing/account over FedWire, then hands us the IMAD/OMAD reference hash.
// The presence of a well-formed reference is what opens the 402 gate.

export type SettlementAccount = {
  beneficiary: string;
  bank: string;
  routing: string | null;
  account: string | null;
  rail: string;
};

export function settlementAccount(): SettlementAccount {
  return {
    beneficiary: process.env["BENEFICIARY_NAME"] || "Abandoned Asset Holdings LLC",
    bank: process.env["BLUEVINE_BANK_NAME"] || "Coastal Community Bank (Bluevine)",
    routing:
      process.env["SETTLEMENT_ROUTING_NUMBER"] || process.env["BLUEVINE_ROUTING_NUMBER"] || null,
    account:
      process.env["SETTLEMENT_ACCOUNT_NUMBER"] || process.env["BLUEVINE_ACCOUNT_NUMBER"] || null,
    rail: "Domestic FedWire / ACH (push only)",
  };
}

export function settlementArmed(): boolean {
  const a = settlementAccount();
  return Boolean(a.routing && a.account);
}

/**
 * FedWire IMAD/OMAD reference hash validation.
 * IMAD: YYYYMMDD + 8-char source + 6-digit sequence (22 chars), but desks also
 * emit vendor hashes — accept any 12+ char alphanumeric reference.
 */
export function validateWireReference(ref: string): { ok: boolean; error?: string } {
  const r = (ref || "").trim();
  if (!r) return { ok: false, error: "fedwire_reference_missing" };
  if (r.length < 12) return { ok: false, error: "fedwire_reference_too_short" };
  if (!/^[A-Za-z0-9_\-.]+$/.test(r)) return { ok: false, error: "fedwire_reference_malformed" };
  return { ok: true };
}
