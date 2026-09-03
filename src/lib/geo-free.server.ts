// Zero-key geocoding + address enrichment.
// Primary: OpenStreetMap Nominatim. Fallback: US Census Geocoder.
// No API keys, no subscriptions. Fail-forward: never throws.

export type FreeGeo = {
  success: boolean;
  formatted_address?: string;
  lat?: string;
  lng?: string;
  county?: string;
  city?: string;
  state?: string;
  postcode?: string;
  source?: "nominatim" | "census";
  reason?: string;
  error?: string;
};

const UA = "AbandonedAssetOS/1.0 (+https://asset-weaver-30.lovable.app)";

// ─── Nominatim rate governor: hard 1 req/sec, serialized queue + memo cache ───
const MIN_INTERVAL_MS = 1000;
const CACHE_MAX = 5000;
const cache = new Map<string, FreeGeo>();
let chain: Promise<void> = Promise.resolve();
let lastCall = 0;

function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
  });
  chain = run.catch(() => {});
  return run.then(fn);
}

export async function getFreePropertyInfo(addressString: string): Promise<FreeGeo> {
  const q = (addressString ?? "").trim();
  if (!q) return { success: false, reason: "empty_address" };

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const result = await throttle(() => geocode(q));
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, result);
  return result;
}

async function geocode(q: string): Promise<FreeGeo> {

  // 1. OpenStreetMap Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data: any = await res.json();
      const item = Array.isArray(data) ? data[0] : null;
      if (item) {
        return {
          success: true,
          formatted_address: item.display_name,
          lat: item.lat,
          lng: item.lon,
          county: item.address?.county ?? "",
          city: item.address?.city ?? item.address?.town ?? item.address?.village ?? "",
          state: item.address?.state ?? "",
          postcode: item.address?.postcode ?? "",
          source: "nominatim",
        };
      }
    }
  } catch (e) {
    console.error("[geo-free] nominatim failed", (e as Error).message);
  }

  // 2. US Census Geocoder fallback (also key-free)
  try {
    const url =
      "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress" +
      `?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (res.ok) {
      const json: any = await res.json();
      const m = json?.result?.addressMatches?.[0];
      if (m) {
        const geo = m.geographies?.Counties?.[0];
        return {
          success: true,
          formatted_address: m.matchedAddress,
          lat: m.coordinates?.y != null ? String(m.coordinates.y) : undefined,
          lng: m.coordinates?.x != null ? String(m.coordinates.x) : undefined,
          county: geo?.NAME ?? "",
          city: m.addressComponents?.city ?? "",
          state: m.addressComponents?.state ?? "",
          postcode: m.addressComponents?.zip ?? "",
          source: "census",
        };
      }
    }
  } catch (e) {
    console.error("[geo-free] census failed", (e as Error).message);
  }

  return { success: false, reason: "address_not_found" };
}

/** Backfills missing zip/county/city on a raw ingest row. Never throws. */
export async function enrichRowFree(row: Record<string, string>) {
  const parts = [row.address, row.city, row.state, row.zip].filter(Boolean).join(", ");
  if (!parts) return row;
  if (row.zip && row.county && row.city) return row;
  const g = await getFreePropertyInfo(parts);
  if (!g.success) return row;
  return {
    ...row,
    zip: row.zip || g.postcode || "",
    county: row.county || g.county || "",
    city: row.city || g.city || "",
    state: row.state || g.state || "",
    lat: g.lat ?? "",
    lng: g.lng ?? "",
  };
}
