// Zero-key autonomous underwriter.
// ARV proxy: US Census ACS 5-yr median owner-occupied home value by ZCTA
// (B25077_001E), scaled by living area vs. the national median footprint.
// Repairs proxy: age + size condition curve. Fail-forward: never throws.

const NATIONAL_MEDIAN_SQFT = 1800;
const zipCache = new Map<string, number | null>();

/** Median home value for a 5-digit ZIP (ZCTA). Null when unavailable. */
export async function getZipMedianValue(zip: string): Promise<number | null> {
  const z = (zip ?? "").trim().slice(0, 5);
  if (!/^\d{5}$/.test(z)) return null;
  if (zipCache.has(z)) return zipCache.get(z)!;
  let out: number | null = null;
  try {
    const url =
      "https://api.census.gov/data/2022/acs/acs5?get=B25077_001E&for=zip%20code%20tabulation%20area:" +
      z;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const json: any = await res.json();
      const v = Number(json?.[1]?.[0]);
      if (isFinite(v) && v > 10_000) out = v;
    }
  } catch (e) {
    console.error("[underwrite] census acs failed", (e as Error).message);
  }
  if (zipCache.size > 4000) zipCache.clear();
  zipCache.set(z, out);
  return out;
}

export type UnderwriteInput = {
  zip?: string | null;
  sqft?: number | null;
  year_built?: number | null;
  beds?: number | null;
  assessed_value?: number | null;
  base_contract_price?: number | null;
  acreage?: number | null;
};

export type UnderwriteResult = {
  arv: number | null;
  repairs: number | null;
  source: "existing" | "acs" | "price_multiple" | "none";
};

/** Derives an ARV + repair budget with no paid API. */
export async function underwrite(row: UnderwriteInput): Promise<UnderwriteResult> {
  try {
    const existing = Number(row.assessed_value) || 0;
    const base = Number(row.base_contract_price) || 0;
    const sqft = Number(row.sqft) || 0;
    const year = Number(row.year_built) || 0;

    let arv: number | null = null;
    let source: UnderwriteResult["source"] = "none";

    if (existing > 0) {
      arv = existing;
      source = "existing";
    } else {
      const median = await getZipMedianValue(String(row.zip ?? ""));
      if (median) {
        const ratio = sqft > 0 ? Math.min(3, Math.max(0.4, sqft / NATIONAL_MEDIAN_SQFT)) : 1;
        arv = Math.round(median * ratio);
        source = "acs";
      } else if (base > 0) {
        // Distressed acquisitions typically trade at ~55-65% of retail.
        arv = Math.round(base / 0.6);
        source = "price_multiple";
      }
    }

    if (!arv || arv <= 0) return { arv: null, repairs: null, source: "none" };

    // Repair curve: baseline $/sqft by build era, floored for unknown sqft.
    const age = year > 1800 ? new Date().getFullYear() - year : 55;
    const perSqft = age >= 70 ? 42 : age >= 45 ? 32 : age >= 25 ? 22 : 12;
    const effSqft = sqft > 0 ? sqft : Math.round(NATIONAL_MEDIAN_SQFT * 0.8);
    let repairs = Math.round(effSqft * perSqft);
    // Never let repairs exceed 30% of ARV — that is a teardown, not a flip.
    repairs = Math.min(repairs, Math.round(arv * 0.3));

    return { arv, repairs, source };
  } catch (e) {
    console.error("[underwrite] failed", (e as Error).message);
    return { arv: null, repairs: null, source: "none" };
  }
}

/** assignment_fee = ARV*0.70 - repairs - offer */
export function computeFee(arv: number, repairs: number, offer: number) {
  return Math.max(0, Math.round(arv * 0.7 - repairs - offer));
}
