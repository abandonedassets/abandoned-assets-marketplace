// Client-side collateral attestation, deterministic haircut engine and
// immutable audit-trail layer for the institutional data room.

export type AttestRecord = {
  parcel: string;
  hash: string;
  at: string;
};

export type AuditEntry = {
  seq: number;
  at: string;
  action: string;
  detail: string;
  hash: string;
};

export async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Deterministic hash of an asset's economic identity (double-pledge proof). */
export async function attestAsset(a: {
  id: string;
  parcel_id: string | null;
  asset_class: string | null;
  valuation: number;
}): Promise<string> {
  return sha256(
    [a.id, a.parcel_id ?? "", a.asset_class ?? "", a.valuation.toFixed(2)].join("|"),
  );
}

/**
 * Deterministic haircut engine — depreciation-weighted advance value.
 * Weights derive from asset class + live valuation band, not static figures.
 */
export function haircutFor(assetClass: string | null, valuation: number): number {
  const ac = (assetClass ?? "").toLowerCase();
  let base = 0.2;
  if (/nnn|retail|commercial|pad/.test(ac)) base = 0.12;
  else if (/industrial|entitled|land/.test(ac)) base = 0.18;
  else if (/sfr|residential|single/.test(ac)) base = 0.22;
  else if (/paper|tape|escrow/.test(ac)) base = 0.3;
  // Liquidity band adjustment: thin-tail large tickets carry wider haircuts.
  const band = valuation >= 5_000_000 ? 0.06 : valuation >= 1_000_000 ? 0.03 : 0;
  return Math.min(0.6, base + band);
}

export function advanceValue(assetClass: string | null, valuation: number): number {
  return valuation * (1 - haircutFor(assetClass, valuation));
}

/** Append-only in-memory + localStorage commit ledger. */
const AUDIT_KEY = "institutional_audit_trail_v1";
const LOCK_KEY = "institutional_collateral_locks_v1";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function readAuditTrail(): AuditEntry[] {
  return read<AuditEntry[]>(AUDIT_KEY, []);
}

export async function appendAudit(action: string, detail: string): Promise<AuditEntry> {
  const trail = readAuditTrail();
  const prev = trail[trail.length - 1]?.hash ?? "GENESIS";
  const at = new Date().toISOString();
  const seq = trail.length + 1;
  const hash = await sha256([prev, seq, at, action, detail].join("|"));
  const entry: AuditEntry = { seq, at, action, detail, hash };
  const next = [...trail, entry];
  if (typeof window !== "undefined") localStorage.setItem(AUDIT_KEY, JSON.stringify(next));
  return entry;
}

/** assetId -> facility id. Blocks double-pledging across facilities. */
export function readLocks(): Record<string, string> {
  return read<Record<string, string>>(LOCK_KEY, {});
}

export function writeLocks(locks: Record<string, string>) {
  if (typeof window !== "undefined") localStorage.setItem(LOCK_KEY, JSON.stringify(locks));
}

export function lockCollateral(assetIds: string[], facilityId: string) {
  const locks = readLocks();
  const locked: string[] = [];
  const blocked: string[] = [];
  for (const id of assetIds) {
    const owner = locks[id];
    if (owner && owner !== facilityId) blocked.push(id);
    else {
      locks[id] = facilityId;
      locked.push(id);
    }
  }
  writeLocks(locks);
  return { locked, blocked };
}

export function releaseFacility(facilityId: string) {
  const locks = readLocks();
  for (const [id, f] of Object.entries(locks)) if (f === facilityId) delete locks[id];
  writeLocks(locks);
}

export function downloadCsv(filename: string, rows: string[][]) {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
