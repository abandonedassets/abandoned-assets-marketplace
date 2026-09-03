// USDA FIA / USFS timber overlay for 5+ acre parcels.
// Zero-key: uses the public USFS Tree Canopy Cover ImageServer when a parcel
// centroid is available, otherwise falls back to a deterministic land-use
// heuristic. Never throws — a failed overlay just yields a null score.

const CANOPY_IMAGESERVER =
  "https://apps.fs.usda.gov/arcx/rest/services/RDW_LandscapeAndWildlife/RDW_TreeCanopyCover/ImageServer/identify";

const MRLC_TCC_LAYER = "nlcd_tcc_conus_2021_v2021-4";

const cache = new Map<string, number | null>();

export const TIMBER_MIN_ACRES = 5;

/** Rough sawtimber yield: ~4 MBF per fully stocked acre, scaled by canopy. */
function stumpageMbf(acres: number, densityScore: number): number {
  return Number((acres * 4 * (densityScore / 100)).toFixed(1));
}

const UA = "Mozilla/5.0 (compatible; AbandonedAssetOS/1.0; +https://asset-weaver-30.lovable.app)";

/** USFS ArcGIS ImageServer identify (primary). */
async function usfsCanopy(lon: number, lat: number): Promise<number | null> {
  const u = new URL(CANOPY_IMAGESERVER);
  u.searchParams.set("geometry", JSON.stringify({ x: lon, y: lat }));
  u.searchParams.set("geometryType", "esriGeometryPoint");
  u.searchParams.set("returnGeometry", "false");
  u.searchParams.set("f", "json");
  u.searchParams.set("sr", "4326");
  u.searchParams.set("tolerance", "1");
  u.searchParams.set("mapExtent", `${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}`);
  u.searchParams.set("imageDisplay", "400,400,96");
  u.searchParams.set("returnCatalogItems", "false");
  const res = await fetch(u.toString(), {
    signal: AbortSignal.timeout(12_000),
    headers: {
      // USDA ArcGIS edge rejects default runtime UAs with 403.
      "User-Agent": UA,
      Accept: "application/json,text/plain,*/*",
      Referer: "https://apps.fs.usda.gov/",
    },
  });
  if (!res.ok) throw new Error(`usfs HTTP ${res.status}`);
  const json: any = await res.json();
  const n = json?.value == null ? NaN : Number(String(json.value).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

/** MRLC NLCD Tree Canopy Cover WMS (fallback when the USFS edge blocks us). */
async function mrlcCanopy(lon: number, lat: number): Promise<number | null> {
  const bbox = `${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}`;
  const u = new URL("https://www.mrlc.gov/geoserver/mrlc_display/wms");
  const p = u.searchParams;
  p.set("service", "WMS");
  p.set("version", "1.1.1");
  p.set("request", "GetFeatureInfo");
  p.set("layers", MRLC_TCC_LAYER);
  p.set("query_layers", MRLC_TCC_LAYER);
  p.set("srs", "EPSG:4326");
  p.set("bbox", bbox);
  p.set("width", "101");
  p.set("height", "101");
  p.set("x", "50");
  p.set("y", "50");
  p.set("info_format", "application/json");
  const res = await fetch(u.toString(), {
    signal: AbortSignal.timeout(12_000),
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`mrlc HTTP ${res.status}`);
  const json: any = await res.json();
  const raw = json?.features?.[0]?.properties?.PALETTE_INDEX;
  const n = raw == null ? NaN : Number(raw);
  return isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

async function canopyPercent(lon: number, lat: number): Promise<number | null> {
  const key = `${lon.toFixed(4)},${lat.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  for (const [name, fn] of [
    ["usfs", usfsCanopy],
    ["mrlc", mrlcCanopy],
  ] as const) {
    try {
      const val = await fn(lon, lat);
      if (val != null) {
        if (cache.size < 5000) cache.set(key, val);
        return val;
      }
    } catch (e) {
      console.error(`[timber] ${name} canopy lookup failed`, (e as Error).message);
    }
  }
  if (cache.size < 5000) cache.set(key, null);
  return null;
}


export async function timberOverlay(input: {
  acreage?: number | null;
  landUse?: string | null;
  lon?: number | null;
  lat?: number | null;
}): Promise<{
  acreage: number | null;
  timber_density_score: number | null;
  estimated_stumpage_mbf: number | null;
  like_kind_eligible: boolean;
}> {
  const acres = Number(input.acreage ?? 0);
  if (!isFinite(acres) || acres < TIMBER_MIN_ACRES) {
    return {
      acreage: isFinite(acres) && acres > 0 ? acres : null,
      timber_density_score: null,
      estimated_stumpage_mbf: null,
      like_kind_eligible: false,
    };
  }

  let density: number | null = null;
  if (input.lon != null && input.lat != null) {
    density = await canopyPercent(Number(input.lon), Number(input.lat));
  }
  if (density == null) {
    // Deterministic fallback from land classification.
    const lu = String(input.landUse ?? "").toLowerCase();
    if (/forest|timber|woodland|tree/.test(lu)) density = 75;
    else if (/agricultur|farm|rural|crop/.test(lu)) density = 35;
    else if (/vacant|land|acreage/.test(lu)) density = 25;
    else density = 15;
  }

  return {
    acreage: acres,
    timber_density_score: density,
    estimated_stumpage_mbf: stumpageMbf(acres, density),
    like_kind_eligible: true,
  };
}
