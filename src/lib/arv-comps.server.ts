// Zero-cost ARV comps engine.
// Tier 1: county ArcGIS FeatureServer sold/parcel layers (OH / KY).
// Tier 2: public Zillow map GraphQL RECENTLY_SOLD feed.
// Tier 3: reverse-strike floor math (no comps required).
// Fail-forward: never throws; a dead endpoint degrades to the next tier.

export type Comp = { price: number; sqft: number; ppsf: number; distance_mi?: number };
export type ArvResult = {
  calculated_arv: number | null;
  arv_source: "COUNTY_REST" | "PUBLIC_GRAPHQL" | null;
  comp_count: number;
  median_ppsf: number | null;
};

const MIN_ARMS_LENGTH = 10_000;
const RADIUS_MI = 1.0;
const SQFT_VARIANCE = 0.25;
const SOLD_MONTHS = 6;
const UA = "AbandonedAssetOS/1.0 (+https://asset-weaver-30.lovable.app)";

// County ArcGIS parcel/sales FeatureServers (unauthenticated, public OpenData).
const COUNTY_LAYERS: Record<string, { url: string; price: string; date: string; sqft: string }> = {
  "OH:HAMILTON": {
    url: "https://services2.arcgis.com/Ur8gRLRvzMhtIvfN/ArcGIS/rest/services/CAGIS_Parcels/FeatureServer/0/query",
    price: "SALE_PRICE",
    date: "SALE_DATE",
    sqft: "FINISHED_SQ_FT",
  },
  "OH:CUYAHOGA": {
    url: "https://services.arcgis.com/afSMGVsC7QlRK1kZ/ArcGIS/rest/services/Parcels/FeatureServer/0/query",
    price: "SALE_AMOUNT",
    date: "SALE_DATE",
    sqft: "TOTAL_LIVING_AREA",
  },
  "OH:FRANKLIN": {
    url: "https://services5.arcgis.com/6yQBQBBEAK3vJ0Nb/ArcGIS/rest/services/Parcel_Polygons/FeatureServer/0/query",
    price: "SALEPRICE",
    date: "SALEDATE",
    sqft: "SQFT",
  },
};

export function median(nums: number[]): number | null {
  const s = nums.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function withinVariance(sqft: number, subject: number) {
  if (!subject) return true;
  return Math.abs(sqft - subject) / subject <= SQFT_VARIANCE;
}

function cutoffIso(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

// ─── Tier 1: county ArcGIS ─────────────────────────────────────────────────
export async function countyComps(
  state: string | null,
  county: string | null,
  lat: number | null,
  lng: number | null,
  subjectSqft: number,
): Promise<Comp[]> {
  const key = `${(state ?? "").toUpperCase()}:${(county ?? "").toUpperCase().replace(/\s+COUNTY$/, "")}`;
  const layer = COUNTY_LAYERS[key];
  if (!layer || lat == null || lng == null) return [];
  try {
    const params = new URLSearchParams({
      f: "json",
      where: `${layer.price} > ${MIN_ARMS_LENGTH} AND ${layer.date} >= DATE '${cutoffIso(SOLD_MONTHS)}'`,
      outFields: `${layer.price},${layer.date},${layer.sqft}`,
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      distance: String(RADIUS_MI * 1609.34),
      units: "esriSRUnit_Meter",
      spatialRel: "esriSpatialRelIntersects",
      returnGeometry: "false",
      resultRecordCount: "200",
    });
    const res = await fetch(`${layer.url}?${params}`, {
      headers: { accept: "application/json", "user-agent": UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { features?: Array<{ attributes: Record<string, unknown> }> };
    return (json.features ?? [])
      .map((f) => {
        const price = Number(f.attributes[layer.price] ?? 0);
        const sqft = Number(f.attributes[layer.sqft] ?? 0);
        return { price, sqft, ppsf: sqft > 0 ? price / sqft : 0 };
      })
      .filter((c) => c.price >= MIN_ARMS_LENGTH && c.sqft > 200 && withinVariance(c.sqft, subjectSqft));
  } catch {
    return [];
  }
}

// ─── Tier 2: public Zillow map feed ────────────────────────────────────────
export async function publicSoldComps(zip: string, subjectSqft: number): Promise<Comp[]> {
  if (!/^\d{5}$/.test(zip)) return [];
  try {
    const wants = {
      searchQueryState: {
        usersSearchTerm: zip,
        filterState: {
          sortSelection: { value: "globalrelevanceex" },
          isRecentlySold: { value: true },
          isForSaleByAgent: { value: false },
          isForSaleByOwner: { value: false },
          isNewConstruction: { value: false },
          isComingSoon: { value: false },
          isAuction: { value: false },
          isForSaleForeclosure: { value: false },
          doz: { value: "6m" },
        },
        isMapVisible: false,
        isListVisible: true,
      },
      wants: { cat1: ["listResults"] },
      requestId: 2,
    };

    const url = `https://www.zillow.com/async-create-search-page-state`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
      body: JSON.stringify(wants),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      cat1?: { searchResults?: { listResults?: Array<Record<string, unknown>> } };
    };
    const rows = json.cat1?.searchResults?.listResults ?? [];
    return rows
      .map((r) => {
        const price = Number(r["unformattedPrice"] ?? r["price"] ?? 0);
        const sqft = Number(
          (r["area"] as number) ?? ((r["hdpData"] as any)?.homeInfo?.livingArea ?? 0),
        );
        return { price, sqft, ppsf: sqft > 0 ? price / sqft : 0 };
      })
      .filter((c) => c.price >= MIN_ARMS_LENGTH && c.sqft > 200 && withinVariance(c.sqft, subjectSqft))
      .slice(0, 25);
  } catch {
    return [];
  }
}

export function arvFromComps(comps: Comp[], subjectSqft: number): { arv: number | null; ppsf: number | null } {
  const ppsf = median(comps.map((c) => c.ppsf));
  if (!ppsf || !subjectSqft) return { arv: null, ppsf };
  return { arv: Math.round(ppsf * subjectSqft), ppsf: Number(ppsf.toFixed(2)) };
}

export function confidenceBand(count: number): "HIGH" | "MEDIUM" | "LOW" | "NONE" {
  if (count >= 8) return "HIGH";
  if (count >= 4) return "MEDIUM";
  if (count >= 1) return "LOW";
  return "NONE";
}
