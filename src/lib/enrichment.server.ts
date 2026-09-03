// Live enrichment provider chain: ATTOM → BatchData.
// Datafiniti is permanently retired (403 CANCELLED_SUBSCRIPTION) and is never
// called. Fail-forward: a dead provider falls through to the next one and
// never writes DLQ noise.

export type EnrichRow = Record<string, string>;

export type EnrichResult = {
  rows: EnrichRow[];
  provider: "attom" | "batchdata" | "none";
  errors: string[];
};

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

async function fetchAttom(apiKey: string, limit: number): Promise<EnrichRow[]> {
  const out: EnrichRow[] = [];
  const counties = ["Montgomery", "Hamilton"];
  for (const county of counties) {
    const url = new URL(
      "https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detail",
    );
    url.searchParams.set("countyname", county);
    url.searchParams.set("statecode", "OH");
    url.searchParams.set("pagesize", String(Math.max(1, Math.min(50, limit))));
    const res = await fetch(url, {
      headers: { apikey: apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`attom HTTP ${res.status}`);
    const json: any = await res.json();
    for (const p of json?.property ?? []) {
      out.push({
        external_id: p?.identifier?.attomId ? `attom:${p.identifier.attomId}` : "",
        address: s(p?.address?.line1),
        city: s(p?.address?.locality),
        state: s(p?.address?.countrySubd) || "OH",
        zip: s(p?.address?.postal1),
        county: s(p?.area?.countrysecsubd) || county,
        price: s(p?.sale?.amount?.saleamt ?? p?.assessment?.market?.mktttlvalue),
        assessedvalue: s(p?.assessment?.assessed?.assdttlvalue),
        beds: s(p?.building?.rooms?.beds),
        baths: s(p?.building?.rooms?.bathstotal),
        sqft: s(p?.building?.size?.livingsize),
        year_built: s(p?.summary?.yearbuilt),
      });
    }
  }
  return out;
}

async function fetchBatchData(apiKey: string, limit: number): Promise<EnrichRow[]> {
  const res = await fetch("https://api.batchdata.com/api/v1/property/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      searchCriteria: { query: "Montgomery County, OH" },
      options: { skip: 0, take: Math.max(1, Math.min(50, limit)) },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`batchdata HTTP ${res.status}`);
  const json: any = await res.json();
  const props: any[] = json?.results?.properties ?? json?.properties ?? [];
  return props.map((p) => ({
    external_id: p?._id ? `batchdata:${p._id}` : "",
    address: s(p?.address?.street),
    city: s(p?.address?.city),
    state: s(p?.address?.state) || "OH",
    zip: s(p?.address?.zip),
    county: s(p?.address?.county),
    price: s(p?.valuation?.estimatedValue ?? p?.sale?.lastSale?.price),
    assessedvalue: s(p?.assessment?.totalAssessedValue),
    beds: s(p?.building?.bedroomCount),
    baths: s(p?.building?.bathroomCount),
    sqft: s(p?.building?.livingAreaSquareFeet),
    year_built: s(p?.building?.yearBuilt),
  }));
}

/** Runs the live provider chain. Never throws. */
export async function fetchEnrichmentRows(limit = 50): Promise<EnrichResult> {
  const errors: string[] = [];
  const attomKey = process.env.ATTOM_API_KEY;
  const batchKey = process.env.BATCHDATA_API_KEY;

  if (attomKey) {
    try {
      const rows = await fetchAttom(attomKey, limit);
      if (rows.length) return { rows, provider: "attom", errors };
      errors.push("attom: empty result");
    } catch (e) {
      errors.push(`attom: ${(e as Error).message}`);
    }
  }

  if (batchKey) {
    try {
      const rows = await fetchBatchData(batchKey, limit);
      if (rows.length) return { rows, provider: "batchdata", errors };
      errors.push("batchdata: empty result");
    } catch (e) {
      errors.push(`batchdata: ${(e as Error).message}`);
    }
  }

  return { rows: [], provider: "none", errors };
}
