// Asset-class aware dynamic assignment-fee matrix.
// Single source of truth for target fee, floor price and cap-rate math.

export type AssetClass = "TIMBERLAND" | "LOT_LAND" | "IMPROVED";

const TIMBER_TYPES = ["TIMBER", "WOODED", "TIMBERLAND", "FOREST"];
const LAND_TYPES = ["LOT", "VACANT_LAND", "LAND", "VACANT", "RAW_LAND"];
const TIMBER_WORDS = ["timber", "wooded", "hardwood", "pulpwood", "acreage", "forest"];

export function classifyAsset(input: {
  asset_type?: string | null;
  zoning_category?: string | null;
  enrichment_tags?: string[] | null;
  address?: string | null;
  sqft?: number | null;
  acreage?: number | null;
  timber_density_score?: number | null;
}): AssetClass {
  const t = String(input.asset_type ?? "").toUpperCase();
  const z = String(input.zoning_category ?? "").toUpperCase();
  const tags = (input.enrichment_tags ?? []).map((x) => String(x).toUpperCase());
  const text = `${input.address ?? ""} ${input.asset_type ?? ""}`.toLowerCase();

  const timber =
    TIMBER_TYPES.some((k) => t.includes(k) || z.includes(k) || tags.includes(k)) ||
    TIMBER_WORDS.some((w) => text.includes(w)) ||
    Number(input.timber_density_score ?? 0) > 0;
  if (timber) return "TIMBERLAND";

  const land =
    LAND_TYPES.some((k) => t.includes(k) || z.includes(k) || tags.includes(k)) ||
    Number(input.sqft ?? 0) === 0;
  if (land) return "LOT_LAND";

  return "IMPROVED";
}

export function targetFee(price: number, cls: AssetClass): number {
  const p = Math.max(0, Number(price) || 0);
  if (cls === "TIMBERLAND") {
    return p < 100_000 ? Math.max(5_000, p * 0.1) : Math.max(10_000, p * 0.075);
  }
  if (cls === "LOT_LAND") {
    if (p < 50_000) return Math.max(2_500, p * 0.1);
    if (p < 150_000) return Math.max(5_000, p * 0.075);
    // $150k+ land follows standard improved rules
  }
  if (p >= 1_000_000) return Math.max(10_000, p * 0.03);
  if (p >= 500_000) return Math.max(10_000, p * 0.035);
  if (p >= 250_000) return Math.max(10_000, p * 0.04);
  return 10_000;
}

export type FeeMath = {
  asset_class: AssetClass;
  repairs: number;
  target_fee: number;
  margin: number;
  is_fee_positive: boolean;
  absolute_floor_price: number | null;
  projected_annual_rent: number;
  projected_cap_rate: number;
};

export function computeFeeMath(input: {
  price: number;
  arv: number;
  repairs?: number | null;
  cls?: AssetClass;
  asset?: Parameters<typeof classifyAsset>[0];
}): FeeMath {
  const cls = input.cls ?? classifyAsset(input.asset ?? {});
  const price = Math.max(0, Number(input.price) || 0);
  const arv = Math.max(0, Number(input.arv) || 0);
  // Land, lots and timber carry no rehab budget.
  const repairs = cls === "IMPROVED" ? Math.max(0, Number(input.repairs ?? 0) || 0) : 0;

  const fee = Math.round(targetFee(price, cls));
  const margin = Math.round(arv - repairs - price);
  const floorRaw = Math.round(arv * 0.7 - repairs - fee);
  const rent = Math.round(arv * 0.012 * 12);
  const denom = price + repairs + fee;
  const capRate = denom > 0 ? (rent * 0.65) / denom : 0;

  return {
    asset_class: cls,
    repairs,
    target_fee: fee,
    margin,
    is_fee_positive: margin >= fee,
    absolute_floor_price: floorRaw > 0 ? floorRaw : null,
    projected_annual_rent: rent,
    projected_cap_rate: Number(capRate.toFixed(4)),
  };
}
