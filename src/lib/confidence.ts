// Local, deterministic lead confidence scoring. No external service, no keys.
// Pass threshold is 60 — anything at or above moves straight to dispatch.

export type ScoredAsset = {
  address?: string | null;
  zip?: string | null;
  contract_value?: number | string | null;
  price?: number | string | null;
  base_contract_price?: number | string | null;
  zoning_class?: string | null;
  zoning_category?: string | null;
  asset_type?: string | null;
  env_status?: string | null;
  enrichment_tags?: string[] | null;
  year_built?: number | null;
  sqft?: number | null;
  fema_zone?: string | null;
  fema_zone_clear?: boolean | null;
  hoa_present?: boolean | null;
  hoa_rental_allowed?: boolean | null;
  env_flag_reason?: string | null;
};

/** Spatial (FEMA/EPA) + HOA rental moratorium screening for Scout evaluation. */
export function spatialHoaClearance(asset: ScoredAsset): {
  fema_zone: string;
  fema_zone_clear: boolean;
  hoa_present: boolean;
  hoa_rental_allowed: boolean;
  hoa_rental_cap_clear: boolean;
} {
  const tags = (asset.enrichment_tags ?? []).map((t) => String(t).toUpperCase());
  const zone = String(asset.fema_zone ?? "").trim().toUpperCase();
  const env = `${asset.env_status ?? ""} ${asset.env_flag_reason ?? ""}`.toUpperCase();
  const highRisk = /^(A|AE|AO|AH|A99|AR|V|VE)$/.test(zone) || /FLOOD|SUPERFUND|EPA/.test(env);
  const femaClear = asset.fema_zone_clear ?? !highRisk;

  const present = asset.hoa_present ?? tags.some((t) => /\bHOA\b/.test(t));
  const capped = tags.some((t) => /RENTAL_CAP|RENTAL_BAN|LEASING_WAITLIST|MORATORIUM/.test(t));
  const allowed = asset.hoa_rental_allowed ?? (!present ? true : !capped);

  return {
    fema_zone: zone || "X",
    fema_zone_clear: !!femaClear,
    hoa_present: !!present,
    hoa_rental_allowed: !!allowed,
    hoa_rental_cap_clear: !present || !!allowed,
  };
}

/** Institutional negative buy-box: commercial overlap, heavy distress, non-standard layout. */
export function negativeBuyBoxPenalty(asset: ScoredAsset): {
  penalty: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  const zoning = `${asset.zoning_class ?? ""} ${asset.zoning_category ?? ""}`.toUpperCase();
  const type = String(asset.asset_type ?? "").toUpperCase();
  const tags = (asset.enrichment_tags ?? []).map((t) => String(t).toUpperCase());

  if (/COMMERCIAL|INDUSTRIAL|MIXED|RETAIL|C-?[123]\b|M-?[12]\b/.test(zoning) && /SFR|RESIDENT/.test(type))
    reasons.push("COMMERCIAL_ADJACENT_RESIDENTIAL");

  if (
    tags.some((t) => /TEARDOWN|FIRE_DAMAGE|CONDEMNED|HEAVY_REHAB|STRUCTURAL/.test(t)) ||
    /CONDEMN|UNINHABIT|FIRE/.test(String(asset.env_status ?? "").toUpperCase())
  )
    reasons.push("HEAVY_DISTRESS");

  const year = Number(asset.year_built ?? 0);
  const sqft = Number(asset.sqft ?? 0);
  if ((year > 0 && year < 1940) || (sqft > 0 && (sqft < 700 || sqft > 4500)))
    reasons.push("NON_STANDARD_LAYOUT");

  return { penalty: reasons.length ? -25 : 0, reasons };
}

export function calculateLeadConfidence(asset: ScoredAsset): {
  score: number;
  passed: boolean;
  penalty?: number;
  penalty_reasons?: string[];
  fema_zone_clear?: boolean;
  hoa_rental_allowed?: boolean;
} {
  let score = 0;
  const address = String(asset.address ?? "");
  const zip = String(asset.zip ?? "");

  // 1. Street number
  if (/^\d+\s+/.test(address.trim())) score += 30;

  // 2. Street name / type
  if (
    /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|way|blvd|boulevard|circle|cir|place|pl|terrace|trl|trail|hwy|highway|pike|parkway|pkwy)\b/i.test(
      address,
    )
  )
    score += 30;

  // 3. Valid 5-digit ZIP (from the address string or the column)
  if (/\b\d{5}\b/.test(address) || /^\d{5}$/.test(zip.trim())) score += 20;

  // 4. Financial data attached
  const money =
    asset.contract_value ?? asset.price ?? asset.base_contract_price ?? null;
  if (money != null && Number(String(money).replace(/[^0-9.\-]/g, "")) > 0) score += 20;

  const neg = negativeBuyBoxPenalty(asset);
  const clear = spatialHoaClearance(asset);
  const reasons = [...neg.reasons];
  let penalty = neg.penalty;

  // Institutional auto-reject overlays (fail-forward: score down, never throw).
  if (!clear.fema_zone_clear) {
    penalty -= 25;
    reasons.push("FEMA_FLOOD_OR_EPA_EXCLUSION");
  }
  if (!clear.hoa_rental_cap_clear) {
    penalty -= 25;
    reasons.push("HOA_RENTAL_MORATORIUM");
  }

  score = Math.max(0, score + penalty);

  return {
    score,
    passed: score >= 60,
    penalty,
    penalty_reasons: reasons,
    fema_zone_clear: clear.fema_zone_clear,
    hoa_rental_allowed: clear.hoa_rental_allowed,
  };
}
