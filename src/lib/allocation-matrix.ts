// 2026 Strategic Macro-Real Estate Allocation Model.
// 21st Century ROAD to Housing Act (Title X): institutional buyers holding
// >= 350 single-family units may not acquire additional 1-2 unit residential
// structures. Screen those out unless they belong to an exempt BTR pipeline.
// Pure + deterministic. Never throws.

export type AllocationBucket =
  | "INDUSTRIAL_LAST_MILE"
  | "MULTI_TENANT_RETAIL"
  | "MULTI_FAMILY_3PLUS"
  | "BTR_SUBDIVISION"
  | "SPECIALIZED_INFRA"
  | "RESTRICTED_SFH"
  | "UNCLASSIFIED";

export const ALLOCATION_WEIGHTS: Record<AllocationBucket, number> = {
  INDUSTRIAL_LAST_MILE: 0.25,
  MULTI_FAMILY_3PLUS: 0.25,
  MULTI_TENANT_RETAIL: 0.2,
  BTR_SUBDIVISION: 0.2,
  SPECIALIZED_INFRA: 0.1,
  RESTRICTED_SFH: 0,
  UNCLASSIFIED: 0,
};

export const ALLOCATION_LABELS: Record<AllocationBucket, string> = {
  INDUSTRIAL_LAST_MILE: "Last-Mile / Light Industrial",
  MULTI_FAMILY_3PLUS: "Multi-Family (3+ Units)",
  MULTI_TENANT_RETAIL: "Multi-Tenant Service Retail",
  BTR_SUBDIVISION: "Build-to-Rent Subdivision",
  SPECIALIZED_INFRA: "Specialized Infrastructure",
  RESTRICTED_SFH: "Restricted SFH (1-2 units)",
  UNCLASSIFIED: "Unclassified / Land",
};

const RX = {
  industrial:
    /\b(industrial|warehouse|distribution|cross[-\s]?dock|logistics|flex|light\s?manufactur|self[-\s]?storage)\b/i,
  retail: /\b(retail|strip\s?center|shopping|storefront|commercial\s?plaza|mixed[-\s]?use|medical\s?office|restaurant|nnn)\b/i,
  multifamily:
    /\b(multi[-\s]?family|multifamily|apartment|triplex|fourplex|quadplex|quad|3[-\s]?plex|4[-\s]?plex|\d{1,3}\s?unit|garden\s?style|mid[-\s]?rise|high[-\s]?rise|mf)\b/i,
  btr: /\b(btr|build[-\s]?to[-\s]?rent|build2rent|subdivision|master[-\s]?plan)\b/i,
  infra: /\b(data\s?center|powered\s?shell|cold\s?storage|telecom|edge\s?hub|colocation)\b/i,
  sfh: /\b(sfr|sfh|single[-\s]?family|duplex|2[-\s]?unit|townhome|townhouse|condo|manufactured|mobile\s?home)\b/i,
};

export type AllocationInput = {
  asset_type?: string | null;
  zoning_category?: string | null;
  zoning_class?: string | null;
  enrichment_tags?: string[] | null;
  buyer_channel?: string | null;
  address?: string | null;
  beds?: number | null;
  sqft?: number | null;
  acreage?: number | null;
};

/** Best-effort dwelling-unit count from the columns we carry. */
export function inferUnitCount(i: AllocationInput): number | null {
  const text = `${i.asset_type ?? ""} ${i.zoning_category ?? ""} ${(i.enrichment_tags ?? []).join(" ")} ${i.address ?? ""}`;
  const m = text.match(/(\d{1,3})\s?[-\s]?(unit|plex)/i);
  if (m?.[1]) {
    const n = Number(m[1]);
    if (n > 0 && n < 500) return n;
  }
  if (/\btriplex|3[-\s]?plex\b/i.test(text)) return 3;
  if (/\bfourplex|quadplex|quad|4[-\s]?plex\b/i.test(text)) return 4;
  if (/\bduplex\b/i.test(text)) return 2;
  if (RX.sfh.test(text)) return 1;
  return null;
}

export type AllocationResult = {
  bucket: AllocationBucket;
  label: string;
  target_weight: number;
  unit_count: number | null;
  btr_exempt: boolean;
  /** true = acquirable under Title X screening. */
  compliant: boolean;
  screen_reason: string | null;
};

export function classifyAllocation(i: AllocationInput): AllocationResult {
  const text = `${i.asset_type ?? ""} ${i.zoning_category ?? ""} ${i.zoning_class ?? ""} ${(i.enrichment_tags ?? []).join(" ")} ${i.buyer_channel ?? ""} ${i.address ?? ""}`;
  const units = inferUnitCount(i);
  const btrExempt = RX.btr.test(text);

  let bucket: AllocationBucket = "UNCLASSIFIED";
  if (RX.infra.test(text)) bucket = "SPECIALIZED_INFRA";
  else if (RX.industrial.test(text)) bucket = "INDUSTRIAL_LAST_MILE";
  else if (btrExempt) bucket = "BTR_SUBDIVISION";
  else if (RX.multifamily.test(text) || (units ?? 0) >= 3) bucket = "MULTI_FAMILY_3PLUS";
  else if (RX.retail.test(text)) bucket = "MULTI_TENANT_RETAIL";
  else if (units != null && units <= 2) bucket = "RESTRICTED_SFH";

  const restricted = bucket === "RESTRICTED_SFH" && !btrExempt;
  return {
    bucket,
    label: ALLOCATION_LABELS[bucket],
    target_weight: ALLOCATION_WEIGHTS[bucket],
    unit_count: units,
    btr_exempt: btrExempt,
    compliant: !restricted,
    screen_reason: restricted
      ? "ROAD to Housing Act Title X: 1-2 unit residential acquisition restricted (no BTR exemption)"
      : null,
  };
}

/** Portfolio drift vs. the target allocation matrix. */
export function allocationDrift(rows: AllocationInput[]) {
  const counts = new Map<AllocationBucket, number>();
  for (const r of rows) {
    const b = classifyAllocation(r).bucket;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const total = rows.length || 1;
  return (Object.keys(ALLOCATION_WEIGHTS) as AllocationBucket[]).map((b) => {
    const n = counts.get(b) ?? 0;
    const actual = n / total;
    return {
      bucket: b,
      label: ALLOCATION_LABELS[b],
      count: n,
      actual_weight: Number(actual.toFixed(4)),
      target_weight: ALLOCATION_WEIGHTS[b],
      drift: Number((actual - ALLOCATION_WEIGHTS[b]).toFixed(4)),
    };
  });
}
