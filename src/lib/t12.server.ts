// Institutional T12 / rent-roll normalizer.
// Converts raw operating statements into the canonical underwriting line items
// every fund investment committee demands. Fail-forward: never throws.

export type RentRollUnit = {
  unit?: string | null;
  beds?: number | null;
  sqft?: number | null;
  market_rent?: number | null;
  actual_rent?: number | null;
  occupied?: boolean | null;
  lease_end?: string | null;
};

export type T12Input = {
  // Either supply monthly arrays (12 entries) or annual totals.
  gross_potential_rent?: number | null;
  monthly_rent?: number[] | null;
  other_income?: number | null;
  vacancy_loss?: number | null;
  concessions?: number | null;
  bad_debt?: number | null;
  real_estate_taxes?: number | null;
  insurance?: number | null;
  utilities?: number | null;
  repairs_maintenance?: number | null;
  management_fee?: number | null;
  payroll?: number | null;
  other_opex?: number | null;
  capex_reserve_per_unit?: number | null;
  rent_roll?: RentRollUnit[] | null;
  units?: number | null;
  // Debt (for loan-maturity distress triggers + DSCR)
  loan_balance?: number | null;
  loan_rate?: number | null;
  loan_maturity_date?: string | null;
  amortization_years?: number | null;
};

export type T12Normalized = {
  units: number;
  gross_potential_rent: number;
  other_income: number;
  vacancy_loss: number;
  economic_vacancy_pct: number;
  effective_gross_income: number;
  operating_expenses: number;
  opex_ratio: number;
  capex_reserve: number;
  noi: number;
  annual_debt_service: number;
  dscr: number | null;
  months_to_maturity: number | null;
  rate_gap_bps: number | null;
  valuation_at_cap: (capRate: number) => number;
};

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const sum = (a?: number[] | null) => (Array.isArray(a) ? a.reduce((s, v) => s + n(v), 0) : 0);

/** Current market benchmark for commercial mortgage coupons (used for rate-gap). */
export const MARKET_DEBT_RATE = 0.0695;

export function normalizeT12(input: T12Input): T12Normalized {
  const roll = Array.isArray(input.rent_roll) ? input.rent_roll : [];
  const units = n(input.units) || roll.length || 1;

  const rollGpr = roll.reduce(
    (s, u) => s + n(u.market_rent || u.actual_rent) * 12,
    0,
  );
  const gpr = n(input.gross_potential_rent) || sum(input.monthly_rent) || rollGpr;

  const rollVacancy = roll.length
    ? roll.filter((u) => u.occupied === false).reduce((s, u) => s + n(u.market_rent) * 12, 0)
    : 0;
  // Never let a missing vacancy field stall a deal: fall back to a 7% market drag.
  const vacancy =
    n(input.vacancy_loss) || rollVacancy || Math.round(gpr * 0.07);

  const loss = vacancy + n(input.concessions) + n(input.bad_debt);
  const egi = Math.max(0, gpr + n(input.other_income) - loss);

  const explicitOpex =
    n(input.real_estate_taxes) +
    n(input.insurance) +
    n(input.utilities) +
    n(input.repairs_maintenance) +
    n(input.payroll) +
    n(input.other_opex);
  const mgmt = n(input.management_fee) || Math.round(egi * 0.04);
  // If the OM omitted expenses entirely, underwrite to a 42% institutional ratio
  // rather than rejecting the deal.
  const opex = explicitOpex > 0 ? explicitOpex + mgmt : Math.round(egi * 0.42);

  const capex = n(input.capex_reserve_per_unit) ? n(input.capex_reserve_per_unit) * units : units * 300;
  const noi = Math.max(0, egi - opex - capex);

  const bal = n(input.loan_balance);
  const rate = n(input.loan_rate);
  const amortYears = n(input.amortization_years) || 30;
  let ads = 0;
  if (bal > 0 && rate > 0) {
    const r = rate / 12;
    const m = amortYears * 12;
    ads = Math.round(((bal * r) / (1 - Math.pow(1 + r, -m))) * 12);
  }

  let monthsToMaturity: number | null = null;
  if (input.loan_maturity_date) {
    const t = Date.parse(String(input.loan_maturity_date));
    if (Number.isFinite(t)) monthsToMaturity = Math.round((t - Date.now()) / (30.44 * 86400000));
  }

  return {
    units,
    gross_potential_rent: Math.round(gpr),
    other_income: Math.round(n(input.other_income)),
    vacancy_loss: Math.round(loss),
    economic_vacancy_pct: gpr > 0 ? Number((loss / gpr).toFixed(4)) : 0,
    effective_gross_income: Math.round(egi),
    operating_expenses: Math.round(opex),
    opex_ratio: egi > 0 ? Number((opex / egi).toFixed(4)) : 0,
    capex_reserve: Math.round(capex),
    noi: Math.round(noi),
    annual_debt_service: ads,
    dscr: ads > 0 ? Number((noi / ads).toFixed(3)) : null,
    months_to_maturity: monthsToMaturity,
    rate_gap_bps: rate > 0 ? Math.round((MARKET_DEBT_RATE - rate) * 10000) : null,
    valuation_at_cap: (capRate: number) => (capRate > 0 ? Math.round(noi / capRate) : 0),
  };
}

export type DistressFlags = {
  loan_maturity_trigger: boolean;
  tax_delinquency_trigger: boolean;
  negative_leverage_trigger: boolean;
  dscr_breach_trigger: boolean;
  distress_score: number; // 0-100 deterministic
  reasons: string[];
};

/** Deterministic pre-distress triggers — no ML, only hard public-record logic. */
export function distressTriggers(args: {
  t12?: T12Normalized | null;
  lien_total?: number | null;
  annual_property_tax?: number | null;
  assessed_value?: number | null;
  days_owned?: number | null;
  estimated_cap_rate?: number | null;
}): DistressFlags {
  const reasons: string[] = [];
  const t = args.t12 ?? null;

  const maturity =
    !!t && t.months_to_maturity !== null && t.months_to_maturity <= 12 && t.months_to_maturity > -6;
  if (maturity) reasons.push(`debt matures in ${t!.months_to_maturity} months`);

  const rateGap = !!t && (t.rate_gap_bps ?? 0) >= 150;
  if (rateGap) reasons.push(`refi gap +${t!.rate_gap_bps}bps vs market`);

  const arv = n(args.assessed_value);
  const lien = n(args.lien_total);
  const taxTrigger = lien > 0 || (arv > 0 && n(args.annual_property_tax) / arv > 0.035);
  if (taxTrigger) reasons.push(lien > 0 ? `active lien $${Math.round(lien)}` : "tax burden > 3.5% of value");

  const dscrBreach = !!t && t.dscr !== null && t.dscr < 1.15;
  if (dscrBreach) reasons.push(`DSCR ${t!.dscr}`);

  const negLev = n(args.estimated_cap_rate) > 0 && n(args.estimated_cap_rate) < MARKET_DEBT_RATE;
  if (negLev) reasons.push("negative leverage at market debt cost");

  const score = Math.min(
    100,
    (maturity ? 34 : 0) +
      (rateGap ? 20 : 0) +
      (taxTrigger ? 24 : 0) +
      (dscrBreach ? 14 : 0) +
      (negLev ? 8 : 0) +
      Math.min(10, Math.round(n(args.days_owned) / 730)),
  );

  return {
    loan_maturity_trigger: maturity || rateGap,
    tax_delinquency_trigger: taxTrigger,
    negative_leverage_trigger: negLev,
    dscr_breach_trigger: dscrBreach,
    distress_score: score,
    reasons,
  };
}
