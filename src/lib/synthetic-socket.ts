// Frontend-only diagnostic bus. Emits a simulated realtime settlement event.
// STRICTLY sterile: no DB writes, no server calls, no ledger mutation.

export type SyntheticSettlementEvent = {
  id: string;
  address: string;
  zip: string;
  memo_id: string;
  buyer_name: string;
  fee_usd: number;
  status: string;
  payout_status: "WIRE_PENDING_VERIFICATION";
  entered_at: string;
  synthetic: true;
};

export const SYNTHETIC_SOCKET_EVENT = "synthetic-settlement-event";

export function emitSyntheticSettlement(): SyntheticSettlementEvent {
  const now = new Date();
  const payload: SyntheticSettlementEvent = {
    id: `synthetic-${now.getTime()}`,
    address: "SYNTHETIC DIAGNOSTIC ASSET",
    zip: "00000",
    memo_id: `SYN-${now.getTime().toString().slice(-6)}`,
    buyer_name: "DIAGNOSTIC COUNTERPARTY",
    fee_usd: 12500,
    status: "Webhook_Dispatched",
    payout_status: "WIRE_PENDING_VERIFICATION",
    entered_at: now.toISOString(),
    synthetic: true,
  };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SYNTHETIC_SOCKET_EVENT, { detail: payload }));
  }
  return payload;
}
