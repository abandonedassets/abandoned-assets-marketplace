// Institutional commercial (CRE) taxonomy, bps fee matrix, NOI/cap-rate math,
// WALT + tenant credit scoring, distress/zoning/environmental telemetry and
// reverse-inquiry buy-box lane routing.
// Pure + deterministic. Never throws.

export type CreClass =
  | "MULTIFAMILY_5PLUS"
  | "LIGHT_INDUSTRIAL"
  | "NNN_RETAIL"
  | "FLEX_STORAGE"
  | "COMMERCIAL_LAND"
  | "NON_COMMERCIAL";

export type CreLane = "CORE_PLUS" | "VALUE_ADD" | "OPPORTUNISTIC" | "PORTFOLIO_ROLLUP" | null;

export type TenantCreditTier = "INVESTMENT_GRADE" | "NON_INVESTMENT_GRADE" | "UNLEASED" | null;

export type CreRow = Record<string, any>;

const RX: Array<[CreClass, RegExp]> = [
  [
    "NNN_RETAIL",
    /\b(nnn|triple\s*net|net[-\s]?lease|retail\s*(pad|strip|center|centre)?|storefront|dollar\s*(general|tree)|walgreens|cvs|autozone|quick\s*lube|c-?store|restaurant|fast\s*food|bank\s*branch)\b/i,
  ],
  [
    "FLEX_STORAGE",
    /\b(flex\s*space|self[-\s]?storage|mini[-\s]?storage|storage\s*(facility|units?)|cold\s*storage|contractor\s*bay|flex\s*industrial)\b/i,
  ],
  [
    "LIGHT_INDUSTRIAL",
    /\b(light\s*industrial|industrial|warehouse|distribution|last[-\s]?mile|manufactur\w*|business\s*park|truck\s*terminal|shop\s*building|data\s*cent(er|re)|substation)\b/i,
  ],
  [
    "MULTIFAMILY_5PLUS",
    /\b(multi-?family|apartment(s)?|apartment\s*complex|\d{1,3}\s*units?|quadplex|fiveplex|garden\s*style|mixed[-\s]?use|sro|student\s*housing|btr|build[-\s]?to[-\s]?rent)\b/i,
  ],
  [
    "COMMERCIAL_LAND",
    /\b(commercial\s*(land|lot|parcel|pad)|c-?[1-4]\b|b-?[1-3]\b|m-?[1-2]\b|i-?[1-2]\b|industrial\s*(land|lot)|pad\s*site|entitled\s*land|development\s*site)\b/i,
  ],
];

const OFFICE_RX = /\b(office(\s*(building|park|suite|condo))?|medical\s*office|mob)\b/i;

function haystack(r: CreRow): string {
  return [
    r["cre_class"],
    r["asset_class"],
    r["asset_type"],
    r["zoning_category"],
    r["zoning_class"],
    r["property_use"],
    r["address"],
    r["notes"],
  ]
    .filter(Boolean)
    .join(" ");
}

/** Explicit commercial taxonomy. Falls back to NON_COMMERCIAL. */
export function classifyCre(r: CreRow): CreClass {
  const t = haystack(r);
  const units = Number(r["unit_count"] ?? r["units"] ?? 0) || 0;
  if (units >= 5) return "MULTIFAMILY_5PLUS";

  // Hard residential guard — SFR/condo/duplex stock is never commercial.
  const struct = `${r["asset_type"] ?? ""} ${r["asset_class"] ?? ""} ${r["zoning_category"] ?? ""} ${r["zoning_class"] ?? ""}`;
  if (/\b(sfr|single[-\s]?family|residential|condo|townh|duplex|triplex|r-?[1-4]\b|mobile\s*home|manufactured)\b/i.test(struct)) {
    return "NON_COMMERCIAL";
  }

  for (const [cls, rx] of RX) if (rx.test(t)) return cls;
  // Office is commercial but has no dedicated enum — treated as flex.
  if (OFFICE_RX.test(t)) return "FLEX_STORAGE";

  // Cap-rate / NOI presence is itself a commercial income signal.
  if (Number(r["noi_usd"] ?? 0) > 0 || Number(r["estimated_cap_rate"] ?? 0) > 0) {
    return Number(r["acreage"] ?? 0) > 0 && !Number(r["sqft"] ?? 0)
      ? "COMMERCIAL_LAND"
      : "FLEX_STORAGE";
  }
  return "NON_COMMERCIAL";
}

export function isCreClass(c: CreClass): boolean {
  return c !== "NON_COMMERCIAL";
}

// ---------------------------------------------------------------------------
// Basis-point fee matrix (replaces flat $ targets on the commercial lane).
// Larger deals compress; faster velocity classes widen.
// ---------------------------------------------------------------------------

const BASE_BPS: Record<CreClass, number> = {
  NNN_RETAIL: 175,
  MULTIFAMILY_5PLUS: 200,
  LIGHT_INDUSTRIAL: 225,
  FLEX_STORAGE: 250,
  COMMERCIAL_LAND: 300,
  NON_COMMERCIAL: 0,
};

/** Fee in basis points of total deal size, clamped to the 100–300 bps band. */
export function feeBps(price: number, cls: CreClass): number {
  if (!isCreClass(cls)) return 0;
  const p = Math.max(0, Number(price) || 0);
  let bps = BASE_BPS[cls];
  if (p >= 25_000_000) bps -= 100;
  else if (p >= 10_000_000) bps -= 75;
  else if (p >= 5_000_000) bps -= 50;
  else if (p >= 1_000_000) bps -= 25;
  return Math.max(100, Math.min(300, bps));
}

/** Dollar fee from the bps matrix (institutional minimum $10,000). */
export function feeFromBps(price: number, cls: CreClass): number {
  const bps = feeBps(price, cls);
  if (!bps) return 0;
  return Math.max(10_000, Math.round(((Number(price) || 0) * bps) / 10_000));
}

// ---------------------------------------------------------------------------
// NOI / expense ratio / dynamic cap rate
// ---------------------------------------------------------------------------

export type CapMath = {
  noi_usd: number | null;
  expense_ratio: number | null;
  cap_rate_actual: number | null;
  cap_rate_proforma: number | null;
  cap_basis: "ACTUAL_NOI" | "PROFORMA_NOI" | "LISTING_ESTIMATE" | "UNKNOWN";
};

const DEFAULT_EXPENSE_RATIO: Record<CreClass, number> = {
  MULTIFAMILY_5PLUS: 0.42,
  LIGHT_INDUSTRIAL: 0.22,
  NNN_RETAIL: 0.05,
  FLEX_STORAGE: 0.32,
  COMMERCIAL_LAND: 0.1,
  NON_COMMERCIAL: 0.35,
};

export function computeCapMath(r: CreRow, cls: CreClass): CapMath {
  const price = Number(r["base_contract_price"]) || 0;
  const gross = Number(r["gross_rent_annual"] ?? r["gross_income_usd"] ?? 0) || 0;
  const opex = Number(r["opex_annual"] ?? r["operating_expenses_usd"] ?? 0) || 0;
  const listedCap = Number(r["estimated_cap_rate"]) || 0;
  const carriedNoi = Number(r["noi_usd"]) || 0;

  let noi: number | null = null;
  let ratio: number | null = null;
  let basis: CapMath["cap_basis"] = "UNKNOWN";

  if (gross > 0 && opex > 0) {
    noi = Number((gross - opex).toFixed(2));
    ratio = Number((opex / gross).toFixed(4));
    basis = "ACTUAL_NOI";
  } else if (gross > 0) {
    ratio = DEFAULT_EXPENSE_RATIO[cls];
    noi = Number((gross * (1 - ratio)).toFixed(2));
    basis = "PROFORMA_NOI";
  } else if (carriedNoi > 0) {
    noi = carriedNoi;
    basis = "ACTUAL_NOI";
  } else if (price > 0 && listedCap > 0) {
    noi = Number((price * listedCap).toFixed(2));
    ratio = DEFAULT_EXPENSE_RATIO[cls];
    basis = "LISTING_ESTIMATE";
  }

  const capActual =
    noi != null && price > 0 && basis === "ACTUAL_NOI"
      ? Number((noi / price).toFixed(4))
      : null;
  const capProforma = noi != null && price > 0 ? Number((noi / price).toFixed(4)) : null;

  return {
    noi_usd: noi,
    expense_ratio: ratio,
    cap_rate_actual: capActual,
    cap_rate_proforma: capProforma,
    cap_basis: basis,
  };
}

// ---------------------------------------------------------------------------
// WALT + tenant credit
// ---------------------------------------------------------------------------

const IG_TENANTS =
  /\b(walgreens|cvs|dollar\s*general|dollar\s*tree|family\s*dollar|autozone|o'?reilly|advance\s*auto|starbucks|mcdonald'?s|chick[-\s]?fil[-\s]?a|taco\s*bell|wendy'?s|7[-\s]?eleven|circle\s*k|fedex|ups|amazon|walmart|target|home\s*depot|lowe'?s|tractor\s*supply|aldi|kroger|publix|verizon|at&t|t-?mobile|us\s*bank|pnc|chase|wells\s*fargo|dialysis|fresenius|davita)\b/i;

/** Weighted average lease term, in years, from any rent roll we carry. */
export function computeWalt(r: CreRow): { walt_years: number | null; tenant_credit_tier: TenantCreditTier } {
  const roll = Array.isArray(r["rent_roll"]) ? (r["rent_roll"] as CreRow[]) : [];
  if (!roll.length) {
    const carried = Number(r["wale_years"] ?? r["walt_years"] ?? 0) || 0;
    const text = haystack(r);
    const tier: TenantCreditTier = IG_TENANTS.test(text)
      ? "INVESTMENT_GRADE"
      : carried > 0
        ? "NON_INVESTMENT_GRADE"
        : "UNLEASED";
    return { walt_years: carried > 0 ? carried : null, tenant_credit_tier: tier };
  }

  const now = Date.now();
  let weighted = 0;
  let rentTotal = 0;
  let igRent = 0;
  for (const t of roll) {
    const rent = Number(t["annual_rent"] ?? t["rent"] ?? 0) || 0;
    const end = Date.parse(String(t["lease_end"] ?? t["expiration"] ?? ""));
    if (!rent || !Number.isFinite(end)) continue;
    const years = Math.max(0, (end - now) / (365.25 * 24 * 3600 * 1000));
    weighted += years * rent;
    rentTotal += rent;
    const name = String(t["tenant"] ?? t["name"] ?? "");
    if (IG_TENANTS.test(name) || t["credit_rated"] === true) igRent += rent;
  }
  if (!rentTotal) return { walt_years: null, tenant_credit_tier: "UNLEASED" };
  return {
    walt_years: Number((weighted / rentTotal).toFixed(2)),
    tenant_credit_tier: igRent / rentTotal >= 0.5 ? "INVESTMENT_GRADE" : "NON_INVESTMENT_GRADE",
  };
}

// ---------------------------------------------------------------------------
// Debt maturity / distress telemetry
// ---------------------------------------------------------------------------

const DISTRESS_RX =
  /\b(balloon|maturity|matures?|refinanc\w*|floating[-\s]?rate|adjustable|cmbs|special\s*servic\w*|forbearance|receiver(ship)?|default|notice\s*of\s*sale|lis\s*pendens|ucc[-\s]?1?|deed\s*in\s*lieu|cash\s*flow\s*shortfall)\b/i;

export function computeDebtDistress(r: CreRow): {
  debt_maturity_date: string | null;
  debt_distress_flag: boolean;
  debt_distress_reason: string | null;
} {
  const raw =
    r["debt_maturity_date"] ??
    r["loan_maturity_date"] ??
    r["mortgage_maturity"] ??
    r["balloon_date"] ??
    null;
  const ts = raw ? Date.parse(String(raw)) : NaN;
  const months = Number.isFinite(ts) ? (ts - Date.now()) / (30.44 * 24 * 3600 * 1000) : null;

  const reasons: string[] = [];
  if (months != null && months <= 12) {
    reasons.push(months <= 0 ? "DEBT_PAST_MATURITY" : `MATURITY_WALL_${Math.max(1, Math.round(months))}M`);
  }
  const text = haystack(r);
  if (DISTRESS_RX.test(text)) reasons.push("PUBLIC_DISTRESS_SIGNAL");
  if (String(r["title_status"] ?? "").toUpperCase() === "UNINSURABLE") reasons.push("TITLE_IMPAIRED");
  if (Number(r["lien_total"] ?? 0) > 0 && Number(r["base_contract_price"] ?? 0) > 0) {
    const ltv = Number(r["lien_total"]) / Number(r["base_contract_price"]);
    if (ltv >= 0.8) reasons.push("HIGH_LIEN_LTV");
  }

  return {
    debt_maturity_date: Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : null,
    debt_distress_flag: reasons.length > 0,
    debt_distress_reason: reasons.length ? reasons.join(",") : null,
  };
}

// ---------------------------------------------------------------------------
// Zoning overlay / adaptive reuse
// ---------------------------------------------------------------------------

const BY_RIGHT_RX =
  /\b(by[-\s]?right|form[-\s]?based|transit[-\s]?oriented|tod\b|overlay|mixed[-\s]?use|adaptive\s*reuse|conversion\s*ordinance|upzon\w*)\b/i;

const FAR_BY_ZONE: Array<[RegExp, number]> = [
  [/\b(c-?[34]|b-?3|cbd|downtown|tod)\b/i, 4],
  [/\b(c-?2|b-?2|mixed[-\s]?use)\b/i, 2.5],
  [/\b(c-?1|b-?1|nc\b|neighborhood\s*commercial)\b/i, 1.5],
  [/\b(m-?[12]|i-?[12]|industrial)\b/i, 1],
];

export function computeZoning(r: CreRow, cls: CreClass): {
  far_potential: number | null;
  adaptive_reuse_by_right: boolean;
  tags: string[];
} {
  const t = haystack(r);
  let far = Number(r["far"] ?? r["far_potential"] ?? 0) || 0;
  if (!far) {
    for (const [rx, v] of FAR_BY_ZONE) {
      if (rx.test(t)) {
        far = v;
        break;
      }
    }
  }
  const byRight = BY_RIGHT_RX.test(t) || (far >= 2.5 && isCreClass(cls));
  const tags: string[] = [];
  if (far >= 2.5) tags.push("HIGH_FAR_POTENTIAL");
  if (byRight) tags.push("ADAPTIVE_REUSE_BY_RIGHT");
  if (cls === "LIGHT_INDUSTRIAL" && far >= 1) tags.push("INDUSTRIAL_CONVERSION_CANDIDATE");
  return { far_potential: far || null, adaptive_reuse_by_right: byRight, tags };
}

// ---------------------------------------------------------------------------
// Phase I environmental / UST screening (signal-based pre-screen)
// ---------------------------------------------------------------------------

const ENV_HAZARD_RX =
  /\b(gas\s*station|fuel|petroleum|ust\b|underground\s*storage|dry\s*clean\w*|auto\s*(body|repair|salvage)|junkyard|plating|foundry|chemical|solvent|brownfield|superfund|landfill|rcra|leaking\s*tank|lust\b)\b/i;

export function screenEnvironment(r: CreRow, cls: CreClass): {
  env_status: string;
  env_flag_reason: string | null;
} {
  const existing = String(r["env_status"] ?? "").toUpperCase();
  if (existing && existing !== "UNKNOWN") {
    return { env_status: existing, env_flag_reason: r["env_flag_reason"] ?? null };
  }
  const t = haystack(r);
  if (ENV_HAZARD_RX.test(t)) {
    const hit = t.match(ENV_HAZARD_RX)?.[0] ?? "hazard";
    return { env_status: "PHASE1_REQUIRED", env_flag_reason: `USE_HAZARD:${hit.toUpperCase()}` };
  }
  if (cls === "LIGHT_INDUSTRIAL" || cls === "FLEX_STORAGE") {
    return { env_status: "PHASE1_RECOMMENDED", env_flag_reason: "INDUSTRIAL_USE_CLASS" };
  }
  return { env_status: "PHASE1_CLEAR", env_flag_reason: null };
}

// ---------------------------------------------------------------------------
// Reverse-inquiry buy-box lane routing
// ---------------------------------------------------------------------------

export function routeCreLane(args: {
  cls: CreClass;
  price: number;
  cap: number | null;
  walt: number | null;
  tier: TenantCreditTier;
  distress: boolean;
  far: number | null;
  vacancy?: number | null;
}): CreLane {
  const { cls, price, cap, walt, tier, distress, far } = args;
  if (!isCreClass(cls)) return null;

  const vacancy = Number(args.vacancy ?? 0) || 0;

  // Core / Core-Plus: stabilized, low cap, long WALT, investment grade.
  if (
    !distress &&
    cap != null &&
    cap >= 0.05 &&
    cap <= 0.07 &&
    (walt ?? 0) >= 7 &&
    tier === "INVESTMENT_GRADE"
  ) {
    return "CORE_PLUS";
  }

  // Opportunistic: distress, heavy vacancy, or high-FAR conversion plays.
  if (distress || vacancy >= 0.3 || (far ?? 0) >= 3) return "OPPORTUNISTIC";

  // Small tickets aggregate into a roll-up to hit deployment minimums.
  if (price > 0 && price < 2_000_000) return "PORTFOLIO_ROLLUP";

  return "VALUE_ADD";
}

export type CreEnrichment = {
  cre_class: CreClass;
  fee_bps: number;
  target_fee_usd: number;
  noi_usd: number | null;
  expense_ratio: number | null;
  estimated_cap_rate: number | null;
  cap_basis: CapMath["cap_basis"];
  walt_years: number | null;
  tenant_credit_tier: TenantCreditTier;
  debt_maturity_date: string | null;
  debt_distress_flag: boolean;
  debt_distress_reason: string | null;
  far_potential: number | null;
  adaptive_reuse_by_right: boolean;
  env_status: string;
  env_flag_reason: string | null;
  cre_lane: CreLane;
  tags: string[];
};

/** One-shot enrichment for a tape row. Pure, never throws. */
export function enrichCre(r: CreRow): CreEnrichment {
  const cls = classifyCre(r);
  const price = Number(r["base_contract_price"]) || 0;
  const cap = computeCapMath(r, cls);
  const walt = computeWalt(r);
  const debt = computeDebtDistress(r);
  const zoning = computeZoning(r, cls);
  const env = screenEnvironment(r, cls);
  const lane = routeCreLane({
    cls,
    price,
    cap: cap.cap_rate_actual ?? cap.cap_rate_proforma,
    walt: walt.walt_years,
    tier: walt.tenant_credit_tier,
    distress: debt.debt_distress_flag,
    far: zoning.far_potential,
    vacancy: r["vacancy_rate"],
  });

  const tags = [...zoning.tags];
  if (isCreClass(cls)) tags.push(`CRE_${cls}`);
  if (debt.debt_distress_flag) tags.push("DEBT_MATURITY_WALL");
  if (env.env_status === "PHASE1_CLEAR") tags.push("PHASE1_CLEAR");
  if (walt.tenant_credit_tier === "INVESTMENT_GRADE") tags.push("INVESTMENT_GRADE_TENANT");
  if (lane) tags.push(`LANE_${lane}`);

  return {
    cre_class: cls,
    fee_bps: feeBps(price, cls),
    target_fee_usd: feeFromBps(price, cls),
    noi_usd: cap.noi_usd,
    expense_ratio: cap.expense_ratio,
    estimated_cap_rate: cap.cap_rate_actual ?? cap.cap_rate_proforma,
    cap_basis: cap.cap_basis,
    walt_years: walt.walt_years,
    tenant_credit_tier: walt.tenant_credit_tier,
    ...debt,
    far_potential: zoning.far_potential,
    adaptive_reuse_by_right: zoning.adaptive_reuse_by_right,
    ...env,
    cre_lane: lane,
    tags,
  };
}
