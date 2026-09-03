// Institutional BTR / commercial routing matrix.
// Pure + deterministic. Never throws. Decides which internal ledger owns an
// asset and which legislative-compliance tags the hedge-fund execution
// algorithms lock onto.
//
// RULES (top-down, first match wins):
//   1. LAND or TIMBER under $100,000            -> DAUGHTER  + ESG_CARBON_CREDIT_ELIGIBLE
//   2. MODULAR home/land in Indiana (IN)        -> JACQUITA  + COMMERCIAL_GRADE_BTR_READY
//   3. Direct COMMERCIAL / >= $100,000 / parcels-> PRIMARY   (Operator ledger)

export type LedgerKey = "PRIMARY" | "JACQUITA" | "DAUGHTER";

export type BtrInput = {
  id?: string | null;
  valuation?: number | null;
  parcel_number?: string | null;
  apn?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  address?: string | null;
  asset_class?: string | null;
  asset_type?: string | null;
  zoning_category?: string | null;
  zoning_class?: string | null;
  acreage?: number | null;
  enrichment_tags?: string[] | null;
};

export type BtrClassification = {
  ledger: LedgerKey;
  ledger_label: string;
  reason: string;
  tags: string[];
};

export const LEDGER_LABELS: Record<LedgerKey, string> = {
  PRIMARY: "Operator Ledger (ReelEdge Entertainment LLC)",
  JACQUITA: "Jaquita — Indiana Modular Ledger",
  DAUGHTER: "Jazmin — Land / Timber ESG Ledger",
};

const TIMBER_RX = /\b(timber|stumpage|logging|mbf|sawmill|woodland|forest)\b/i;
const LAND_RX = /\b(land|lot|acre|acreage|raw[-\s]?land|vacant|parcel|farm|ranch)\b/i;
const MODULAR_RX = /\b(modular|manufactured|prefab|pre[-\s]?fab|mobile\s?home|panelized)\b/i;
const COMMERCIAL_RX =
  /\b(commercial|multifamily|multi[-\s]?family|retail|industrial|office|warehouse|mixed[-\s]?use|apartment|btr|build[-\s]?to[-\s]?rent)\b/i;

function text(i: BtrInput): string {
  return [
    i.asset_class,
    i.asset_type,
    i.zoning_category,
    i.zoning_class,
    i.address,
    (i.enrichment_tags ?? []).join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

export function isTimber(i: BtrInput): boolean {
  return TIMBER_RX.test(text(i));
}

export function isLand(i: BtrInput): boolean {
  const t = text(i);
  if (LAND_RX.test(t)) return true;
  // Acreage with no structure signal reads as raw land.
  return Number(i.acreage ?? 0) > 0 && !/\b(sfr|house|home|duplex|condo)\b/i.test(t);
}

export function isModular(i: BtrInput): boolean {
  return MODULAR_RX.test(text(i));
}

export function isCommercial(i: BtrInput): boolean {
  return COMMERCIAL_RX.test(text(i));
}

export function isIndiana(i: BtrInput): boolean {
  const st = String(i.state ?? "").trim().toUpperCase();
  if (st === "IN" || st.startsWith("INDIANA")) return true;
  return /\bindiana\b/i.test(`${i.county ?? ""} ${i.city ?? ""} ${i.address ?? ""}`);
}

/** Even/odd parity of the parcel identifier (defaults EVEN). */
export function parcelParity(i: BtrInput): "EVEN" | "ODD" {
  const digits = String(i.parcel_number ?? i.apn ?? i.id ?? "").replace(/\D/g, "");
  if (!digits) return "EVEN";
  return Number(digits.slice(-1)) % 2 === 0 ? "EVEN" : "ODD";
}

export function classifyBtr(input: BtrInput): BtrClassification {
  const valuation = Number(input.valuation ?? 0) || 0;
  const tags: string[] = [];

  // 1. Land / timber under $100k -> Daughter's ESG ledger.
  if ((isLand(input) || isTimber(input)) && valuation > 0 && valuation < 100_000) {
    tags.push("ESG_CARBON_CREDIT_ELIGIBLE", "LAND_MITIGATION_BANK");
    if (isTimber(input)) tags.push("TIMBER_OFFSET_PORTFOLIO");
    return {
      ledger: "DAUGHTER",
      ledger_label: LEDGER_LABELS.DAUGHTER,
      reason: "Land/timber under $100,000 — ESG carbon-credit ledger",
      tags: withLedger("DAUGHTER", tags),
    };
  }

  // 2. Indiana modular -> Jaquita, re-classified as commercial-grade BTR.
  if (isModular(input) && isIndiana(input)) {
    tags.push(
      "COMMERCIAL_GRADE_BTR_READY",
      "BTR_COMPLIANT",
      "COMMERCIAL_ZONED_MULTIFAMILY",
      "RAPID_DEPLOYMENT_MODULAR",
    );
    return {
      ledger: "JACQUITA",
      ledger_label: LEDGER_LABELS.JACQUITA,
      reason: "Indiana modular — commercial-grade BTR reclassification",
      tags: withLedger("JACQUITA", tags),
    };
  }

  // 3. Operator ledger: commercial, >= $100k, and the even/odd parcel book.
  if (isCommercial(input)) tags.push("BTR_COMPLIANT", "COMMERCIAL_ZONED_MULTIFAMILY");
  if (valuation >= 100_000) tags.push("INSTITUTIONAL_TICKET");
  tags.push(`PARCEL_${parcelParity(input)}`);
  return {
    ledger: "PRIMARY",
    ledger_label: LEDGER_LABELS.PRIMARY,
    reason: isCommercial(input)
      ? "Direct commercial asset — Operator ledger"
      : valuation >= 100_000
        ? "Valuation >= $100,000 — Operator ledger"
        : "Operator parcel book (even/odd assembly pool)",
    tags: withLedger("PRIMARY", tags),
  };
}

function withLedger(k: LedgerKey, tags: string[]): string[] {
  return Array.from(new Set([`LEDGER_${k}`, ...tags]));
}

/** Merge classification tags into an existing tag array without duplication. */
export function mergeTags(existing: string[] | null | undefined, add: string[]): string[] {
  const keep = (existing ?? []).filter((t) => !/^LEDGER_/.test(t));
  return Array.from(new Set([...keep, ...add]));
}

export function ledgerOf(tags: string[] | null | undefined): LedgerKey {
  const t = tags ?? [];
  if (t.includes("LEDGER_DAUGHTER")) return "DAUGHTER";
  if (t.includes("LEDGER_JACQUITA")) return "JACQUITA";
  return "PRIMARY";
}

/** Street key used for contiguous-parcel assembly (zip + normalized street). */
export function streetKey(address: string | null | undefined, zip: string | null | undefined): string | null {
  const street = String(address ?? "")
    .toUpperCase()
    .replace(/^\s*\d+\s+/, "")
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!street) return null;
  return `${String(zip ?? "").trim()}|${street}`;
}

/** Leading house/parcel number used to test adjacency along a street. */
export function houseNumber(address: string | null | undefined): number | null {
  const m = String(address ?? "").trim().match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}
