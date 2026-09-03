// Multi-tier asset distribution + split payout routing matrix.
// Pure + deterministic. Never throws. Decides which destination account
// receives net proceeds for a settled asset.
//
// LOCKED HIERARCHY (evaluated top-down, first match wins):
//   1. MUNCIE EXCLUSIVITY  — any asset in Muncie, Indiana  -> JAQUITA 100%
//   2. TIMBER EXCLUSIVITY  — timber land outside Muncie    -> JAZMIN  100%
//   3. VALUATION >= $100k                                   -> PRIMARY 100%
//   4. VALUATION <  $100k  — parcel parity: EVEN -> PRIMARY (user), ODD -> JAZMIN
//
// Key names are kept stable for the DB/ledger: JACQUITA = Jaquita,
// DAUGHTER = Jazmin (a.k.a. Jasmine).

export type BeneficiaryKey = "PRIMARY" | "JACQUITA" | "DAUGHTER";

export type RoutingCode =
  | "ROUTE_MUNCIE_JAQUIDA"
  | "ROUTE_TIMBER_JASMINE"
  | "MASTER_SYSTEM_100K_PLUS"
  | "SUB_100K_PARITY_EVEN_MASTER"
  | "SUB_100K_PARITY_ODD_JASMINE";

export type BeneficiaryRoute = {
  key: BeneficiaryKey;
  label: string;
  pct: number; // 0..1
  reason: string;
  code: RoutingCode;
};

export type RoutingInput = {
  id?: string | null;
  valuation?: number | null;
  parcel_number?: string | null;
  apn?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  asset_class?: string | null;
  asset_type?: string | null;
  zoning_category?: string | null;
  address?: string | null;
  has_timber?: boolean | null;
  enrichment_tags?: string[] | null;
};

export const BENEFICIARY_LABELS: Record<BeneficiaryKey, string> = {
  PRIMARY: "Primary Clearing Account (ReelEdge Entertainment LLC)",
  JACQUITA: "Jaquita — Designated Destination Account",
  DAUGHTER: "Jazmin — Designated Destination Account",
};

const TIMBER_RX = /\b(timber|stumpage|timber[-\s]?clear|logging|mbf|sawmill)\b/i;
const MUNCIE_RX = /\bmuncie\b/i;

/** Even/odd digit parity of the parcel identifier (defaults to EVEN). */
export function parcelParity(input: RoutingInput): "EVEN" | "ODD" {
  const raw = String(input.parcel_number ?? input.apn ?? input.id ?? "");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "EVEN";
  return Number(digits.slice(-1)) % 2 === 0 ? "EVEN" : "ODD";
}

/** Muncie, Indiana detection across city / county / address / tags. */
export function isMuncie(input: RoutingInput): boolean {
  const tags = (input.enrichment_tags ?? []).join(" ");
  const text = `${input.city ?? ""} ${input.county ?? ""} ${input.address ?? ""} ${tags}`;
  if (!MUNCIE_RX.test(text)) return false;
  const state = String(input.state ?? "").trim().toUpperCase();
  // Accept when state is Indiana or unknown (Muncie is unambiguous in feed data).
  return state === "" || state.startsWith("IN") || /indiana/i.test(text);
}

export function hasTimber(input: RoutingInput): boolean {
  if (input.has_timber === true) return true;
  const tags = (input.enrichment_tags ?? []).join(" ");
  const text = `${input.asset_class ?? ""} ${input.asset_type ?? ""} ${input.zoning_category ?? ""} ${input.address ?? ""} ${tags}`;
  return TIMBER_RX.test(text);
}

export function routeBeneficiaries(input: RoutingInput): BeneficiaryRoute[] {
  const valuation = Number(input.valuation ?? 0) || 0;

  // 1. Muncie, Indiana — supersedes valuation, parity and timber.
  if (isMuncie(input)) {
    return [
      {
        key: "JACQUITA",
        label: BENEFICIARY_LABELS.JACQUITA,
        pct: 1,
        reason: "Muncie, Indiana mandate — 100% Jaquita",
        code: "ROUTE_MUNCIE_JAQUIDA",
      },
    ];
  }

  // 2. Timber land outside Muncie.
  if (hasTimber(input)) {
    return [
      {
        key: "DAUGHTER",
        label: BENEFICIARY_LABELS.DAUGHTER,
        pct: 1,
        reason: "Timber mandate (outside Muncie) — 100% Jazmin",
        code: "ROUTE_TIMBER_JASMINE",
      },
    ];
  }

  // 3. $100k or greater — master system.
  if (valuation >= 100_000) {
    return [
      {
        key: "PRIMARY",
        label: BENEFICIARY_LABELS.PRIMARY,
        pct: 1,
        reason: "Valuation >= $100,000 — 100% master system",
        code: "MASTER_SYSTEM_100K_PLUS",
      },
    ];
  }

  // 4. Sub-$100k shared pool — parcel parity.
  return parcelParity(input) === "EVEN"
    ? [
        {
          key: "PRIMARY",
          label: BENEFICIARY_LABELS.PRIMARY,
          pct: 1,
          reason: "Sub-$100k · EVEN parcel — master system",
          code: "SUB_100K_PARITY_EVEN_MASTER",
        },
      ]
    : [
        {
          key: "DAUGHTER",
          label: BENEFICIARY_LABELS.DAUGHTER,
          pct: 1,
          reason: "Sub-$100k · ODD parcel — Jazmin",
          code: "SUB_100K_PARITY_ODD_JASMINE",
        },
      ];
}

/** Single routing decision code for the audit trail. */
export function routingDecisionCode(input: RoutingInput): RoutingCode {
  return routeBeneficiaries(input)[0]!.code;
}

/** Dollar split of net proceeds, cents-exact (remainder to first leg). */
export function splitProceeds(input: RoutingInput, netUsd: number) {
  const routes = routeBeneficiaries(input);
  const total = Math.round((Number(netUsd) || 0) * 100);
  const legs = routes.map((r) => ({ ...r, cents: Math.floor(total * r.pct) }));
  const drift = total - legs.reduce((s, l) => s + l.cents, 0);
  if (legs[0]) legs[0].cents += drift;
  return legs.map((l) => ({
    key: l.key,
    label: l.label,
    reason: l.reason,
    code: l.code,
    pct: l.pct,
    amount_usd: l.cents / 100,
  }));
}
