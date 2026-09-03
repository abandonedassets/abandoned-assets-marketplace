// Client-safe micro-state derivation for the Settlement Terminal telemetry.
// ZERO-MASKING TRUTH: there is no default/fallback label. Any status the
// frontend does not explicitly map renders as `UNMAPPED: <raw_status>`.

export const EXECUTION_STATES = [
  "DATA_ENRICHMENT_QUEUED",
  "UNDERWRITING_IN_PROGRESS",
  "REVERSE_STRIKE_READY",
  "WEBHOOK_DISPATCHED_AUTO",
  "AWAITING_INBOUND_WIRE",
  "FEES_IN_TRANSIT",
  "SETTLED_BLUEVINE",
] as const;

export type KnownExecutionState = (typeof EXECUTION_STATES)[number];
/** Either a mapped state or an explicit `UNMAPPED: <raw>` debug label. */
export type ExecutionState = string;

export type ExecutionRow = {
  id: string;
  address?: string | null;
  zip?: string | null;
  status?: string | null;
  payout_status?: string | null;
  optimized_acquisition_premium?: number | string | null;
  updated_at?: string | null;
};

const STATUS_MAP: Record<string, KnownExecutionState> = {
  // enrichment lane
  "Auto-Enrichment-Pending": "DATA_ENRICHMENT_QUEUED",
  Scout: "DATA_ENRICHMENT_QUEUED",
  // underwriting lane
  "Pending-Underwriting": "UNDERWRITING_IN_PROGRESS",
  Underwriting: "UNDERWRITING_IN_PROGRESS",
  // strike lane
  New: "REVERSE_STRIKE_READY",
  "Reverse-Strike": "REVERSE_STRIKE_READY",
  REVERSE_STRIKE_READY: "REVERSE_STRIKE_READY",
  Webhook_Dispatched: "WEBHOOK_DISPATCHED_AUTO",
  // wire lane
  "Locked-Escrow-Pending": "AWAITING_INBOUND_WIRE",
  AWAITING_INBOUND_WIRE: "AWAITING_INBOUND_WIRE",
  SETTLED_ATOMIC: "AWAITING_INBOUND_WIRE",
  // transit lane
  "In-Escrow": "FEES_IN_TRANSIT",
  "Buyer-Signed": "FEES_IN_TRANSIT",
  "Wire-Sent": "FEES_IN_TRANSIT",
  // settled
  "Funds-Cleared": "SETTLED_BLUEVINE",
  Closed: "SETTLED_BLUEVINE",
};

const PAYOUT_MAP: Record<string, KnownExecutionState> = {
  WIRE_PENDING_VERIFICATION: "AWAITING_INBOUND_WIRE",
  AWAITING_INBOUND_WIRE: "AWAITING_INBOUND_WIRE",
  PENDING: "FEES_IN_TRANSIT",
  IN_TRANSIT: "FEES_IN_TRANSIT",
  SETTLED_PAID: "SETTLED_BLUEVINE",
};

export function isUnmapped(state: ExecutionState) {
  return state.startsWith("UNMAPPED:");
}

export function deriveExecutionState(row: ExecutionRow): ExecutionState {
  // 1. payout_status wins — capital movement outranks pipeline status.
  const payout = String(row.payout_status ?? "").trim();
  if (payout && PAYOUT_MAP[payout]) return PAYOUT_MAP[payout];

  const status = String(row.status ?? "").trim();
  if (!status) return "UNMAPPED: (null status)";
  const mapped = STATUS_MAP[status];
  if (mapped) return mapped;

  // 2. No silent fallback. Show the raw database truth.
  return `UNMAPPED: ${status}`;
}

const KNOWN_ACCENT: Record<KnownExecutionState, string> = {
  DATA_ENRICHMENT_QUEUED: "border-zinc-500/40 text-zinc-400",
  UNDERWRITING_IN_PROGRESS: "border-blue-500/50 text-blue-400",
  REVERSE_STRIKE_READY: "border-slate-500/50 text-slate-300",
  WEBHOOK_DISPATCHED_AUTO: "border-sky-500/50 text-sky-400",
  AWAITING_INBOUND_WIRE: "border-amber-500/50 text-amber-400",
  FEES_IN_TRANSIT: "border-violet-500/50 text-violet-400",
  SETTLED_BLUEVINE: "border-emerald-500/50 text-emerald-400",
};

const UNMAPPED_ACCENT = "border-rose-500/60 text-rose-400";

export function accentFor(state: ExecutionState): string {
  return KNOWN_ACCENT[state as KnownExecutionState] ?? UNMAPPED_ACCENT;
}

/** Back-compat proxy so `STATE_ACCENT[state]` never returns undefined. */
export const STATE_ACCENT: Record<string, string> = new Proxy(KNOWN_ACCENT as Record<string, string>, {
  get: (target, key: string) => target[key] ?? UNMAPPED_ACCENT,
});
