// Strict institutional buy-box matching layer.
// An asset only carries a fund id if it passes 100% of that fund's criteria.
// Fail-forward: any error yields an empty match set, never a throw.

export type BuyBox = {
  id: string;
  fund_name: string;
  min_beds: number;
  min_baths: number;
  min_sqft: number;
  min_year_built: number;
  requires_garage: boolean;
  max_hoa_monthly: number;
  max_repair_budget: number;
  min_cap_rate: number;
  target_zips: string[];
  is_active: boolean;
};

export type AssetTraits = {
  zip?: string | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  year_built?: number | null;
  has_garage?: boolean | null;
  hoa_monthly?: number | null;
  estimated_repairs?: number | null;
  assessed_value?: number | null; // ARV
  base_contract_price?: number | null;
  optimized_acquisition_premium?: number | null; // assignment fee
};

/** Gross rent proxy: 0.7% of ARV per month (classic SFR rent-to-value rule). */
export function estimateMonthlyRent(arv: number): number {
  return Math.round(arv * 0.007);
}

/** cap_rate = (monthly_rent * 12 * 0.65) / total_to_buyer */
export function computeCapRate(traits: AssetTraits): number | null {
  const arv = Number(traits.assessed_value) || 0;
  const offer = Number(traits.base_contract_price) || 0;
  const fee = Number(traits.optimized_acquisition_premium) || 0;
  const total = offer + fee;
  if (arv <= 0 || total <= 0) return null;
  const noi = estimateMonthlyRent(arv) * 12 * 0.65;
  return Number((noi / total).toFixed(4));
}

/** Returns fund ids whose every criterion the asset satisfies. */
export function matchBuyBoxes(
  traits: AssetTraits,
  boxes: BuyBox[],
  capRate: number | null,
): string[] {
  const out: string[] = [];
  for (const b of boxes) {
    try {
      if (!b.is_active) continue;
      if (b.target_zips.length > 0 && !b.target_zips.includes(String(traits.zip ?? "").slice(0, 5)))
        continue;
      if ((Number(traits.beds) || 0) < Number(b.min_beds)) continue;
      if ((Number(traits.baths) || 0) < Number(b.min_baths)) continue;
      if (Number(b.min_sqft) > 0 && (Number(traits.sqft) || 0) < Number(b.min_sqft)) continue;
      if ((Number(traits.year_built) || 0) < Number(b.min_year_built)) continue;
      if (b.requires_garage && traits.has_garage !== true) continue;
      if ((Number(traits.hoa_monthly) || 0) > Number(b.max_hoa_monthly)) continue;
      if ((Number(traits.estimated_repairs) || 0) > Number(b.max_repair_budget)) continue;
      if (capRate === null || capRate < Number(b.min_cap_rate)) continue;
      out.push(b.id);
    } catch {
      /* fail-forward */
    }
  }
  return out;
}

export async function loadActiveBuyBoxes(): Promise<BuyBox[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("institutional_buy_boxes")
      .select("*")
      .eq("is_active", true);
    return (data ?? []) as unknown as BuyBox[];
  } catch (e) {
    console.error("[buybox] load failed", (e as Error).message);
    return [];
  }
}

/** Evaluate one asset and return the patch fields to persist. */
export function evaluateAsset(traits: AssetTraits, boxes: BuyBox[]) {
  const capRate = computeCapRate(traits);
  const matched = matchBuyBoxes(traits, boxes, capRate);
  return { estimated_cap_rate: capRate, matched_fund_ids: matched };
}
