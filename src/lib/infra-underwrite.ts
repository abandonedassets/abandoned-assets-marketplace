// Lean infrastructure underwriting: fast integer/string prefilters first,
// DSCR math last. No spatial calls in this module.

/** Strip padding/dashes from raw assessor ZIP fields -> { zip5, plus4 }. */
export function sanitizeZip(raw: unknown): { zip5: string | null; plus4: string | null } {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length >= 9) return { zip5: digits.slice(0, 5), plus4: digits.slice(5, 9) };
  if (digits.length >= 5) return { zip5: digits.slice(0, 5), plus4: null };
  if (digits.length > 0) return { zip5: digits.padStart(5, "0"), plus4: null };
  return { zip5: null, plus4: null };
}

/** Stage 2 raster-style mask: cheap terrain reject before any geometry math. */
export function passesTerrainMask(input: {
  slope_pct?: number | null;
  wetland_pct?: number | null;
}): boolean {
  const slope = Number(input.slope_pct ?? 0);
  const wet = Number(input.wetland_pct ?? 0);
  if (isFinite(slope) && slope > 3.0) return false;
  if (isFinite(wet) && wet > 10) return false;
  return true;
}

export type SpatialData = {
  buildable_acreage_net: number;
  gross_acreage: number;
  target_acquisition_strike_price: number;
};

export type UnderwriteResult =
  | { status: "REJECTED"; reason: string; score?: number }
  | {
      status: "APPROVED";
      metrics: {
        base_energy_kwh_projected_annual: number;
        net_operating_income_usd: number;
        calculated_dscr_target: number;
        project_readiness_score: number;
      };
    };

const DSCR_FLOOR = 1.3;
const PPA_RATE = 0.06;
const KWH_PER_ACRE = 200_000;
const CAPACITY_FACTOR = 0.2;

/** Stage 4 financial loop. Drops anything under the 1.30 institutional floor. */
export function underwriteInfrastructureAsset(spatial: SpatialData): UnderwriteResult {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const buildable = Number(spatial.buildable_acreage_net) || 0;
  const gross = Number(spatial.gross_acreage) || 0;
  const strike = Number(spatial.target_acquisition_strike_price) || 0;

  const energy = buildable * KWH_PER_ACRE * CAPACITY_FACTOR;
  const revenue = energy * PPA_RATE;
  const opex = gross * 100 + buildable * 250;
  const noi = revenue - opex;

  const debtService = strike * 0.08;
  if (debtService <= 0) return { status: "REJECTED", reason: "invalid_strike_price" };

  const dscr = noi / debtService;
  if (dscr < DSCR_FLOOR)
    return { status: "REJECTED", reason: "dscr_below_institutional_floor", score: round2(dscr) };

  return {
    status: "APPROVED",
    metrics: {
      base_energy_kwh_projected_annual: round2(energy),
      net_operating_income_usd: round2(noi),
      calculated_dscr_target: round2(dscr),
      project_readiness_score: Math.round(Math.min(100, (dscr / 1.5) * 100) * 10) / 10,
    },
  };
}

// ---------------------------------------------------------------------------
// Tiered M2M underwriting entry point (pure; no crypto, no IO).
// Order: grid distance -> terrain mask -> metric sanity -> DSCR core.
// ---------------------------------------------------------------------------

export interface IngestionPayload {
  apn_raw: string;
  fips_code?: string | null;
  owner_zip_raw?: string | null;
  gross_acreage: number;
  buildable_acreage_net: number;
  target_acquisition_strike_price: number;
  substation_distance_miles: number;
  max_slope?: number | null;
  wetland_pct?: number | null;
  annual_tax_assessment?: number | null;
}

/** Bad-data guard: county feeds report $0 tax on exempt/defaulted parcels. */
export const MIN_ANNUAL_TAX_USD = 500;

export type TieredUnderwriteResult =
  | { status: "REJECTED"; reason: string; dscr?: number }
  | {
      status: "APPROVED";
      metrics: {
        base_energy_kwh_projected_annual: number;
        net_operating_income_usd: number;
        annual_tax_assessment_usd: number;
        calculated_dscr_target: number;
      };
      zip: { raw_string: string; postal_code: string | null; plus_four: string | null; regex_match_type: string };
    };

export function processAssetUnderwriting(asset: IngestionPayload): TieredUnderwriteResult {
  // Tier 1 — grid proximity hard stop
  if (Number(asset.substation_distance_miles) > 1.0)
    return { status: "REJECTED", reason: "GRID_DISTANCE_EXCEEDS_1_MILE_RADIUS" };

  // Tier 2 — terrain / environmental mask
  if (!passesTerrainMask({ slope_pct: asset.max_slope, wetland_pct: asset.wetland_pct }))
    return { status: "REJECTED", reason: "TERRAIN_UNBUILDABLE_SLOPE_OR_WETLAND" };

  const buildable = Number(asset.buildable_acreage_net) || 0;
  const gross = Number(asset.gross_acreage) || 0;
  const strike = Number(asset.target_acquisition_strike_price) || 0;
  if (buildable <= 0 || strike <= 0)
    return { status: "REJECTED", reason: "INVALID_METRICS_OR_ZERO_NET_ACREAGE" };

  // Tier 3 — financial core
  const energy = buildable * KWH_PER_ACRE * CAPACITY_FACTOR;
  const revenue = energy * PPA_RATE;
  const tax = Math.max(Number(asset.annual_tax_assessment ?? 0) || 0, gross * 100, MIN_ANNUAL_TAX_USD);
  const noi = revenue - (tax + buildable * 250);
  const debtService = strike * 0.08;
  if (debtService <= 0) return { status: "REJECTED", reason: "DEBT_SERVICE_DIVIDE_BY_ZERO" };

  const dscr = Math.round((noi / debtService) * 100) / 100;
  if (dscr < DSCR_FLOOR)
    return { status: "REJECTED", reason: "DSCR_BELOW_INSTITUTIONAL_1.30_FLOOR", dscr };

  const z = sanitizeZip(asset.owner_zip_raw);
  const rawZip = String(asset.owner_zip_raw ?? "");
  return {
    status: "APPROVED",
    metrics: {
      base_energy_kwh_projected_annual: Math.round(energy),
      net_operating_income_usd: Math.round(noi),
      annual_tax_assessment_usd: Math.round(tax),
      calculated_dscr_target: dscr,
    },
    zip: {
      raw_string: rawZip,
      postal_code: z.zip5,
      plus_four: z.plus4,
      regex_match_type: z.plus4 ? "unpadded_9_digit" : z.zip5 ? "zip5" : "unparsed",
    },
  };
}
