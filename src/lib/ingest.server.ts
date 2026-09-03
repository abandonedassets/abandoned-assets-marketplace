// Stage 1 — Automated distressed-asset ingestion.
// Any vendor / county / scraper payload shape is aliased, SHA-256 hashed for
// title + deal-tape integrity (no duplicate rows), inserted into
// closing_pipeline_items as Pending-Underwriting, and immediately handed to
// the algorithmic underwriter (Stage 2). Fail-forward per row.

export type IngestResult = {
  ok: true;
  source: string;
  total: number;
  inserted: number;
  deduped: number;
  dlq: number;
  ids: string[];
};

function pick(o: Record<string, any>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o?.[k] ?? o?.[k.toLowerCase()] ?? o?.[k.toUpperCase()];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  return isFinite(n) && n > 0 ? n : null;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeAsset(d: Record<string, any>) {
  const address = pick(d, ["address", "street", "property_address", "addr", "site_address"]);
  const zip = (pick(d, ["zip", "zipcode", "postal_code", "postcode"]) ?? "").slice(0, 5);
  const price = num(
    d["price"] ?? d["offer_price"] ?? d["asking_price"] ?? d["base_contract_price"] ?? d["list_price"],
  );
  return {
    address,
    zip,
    price,
    city: pick(d, ["city", "municipality"]),
    state: pick(d, ["state", "st"]),
    county: pick(d, ["county"]),
    apn: pick(d, ["apn", "parcel_id", "parcel", "parcel_number"]),
    assessed_value: num(d["arv"] ?? d["assessed_value"] ?? d["market_value"]),
    estimated_repairs: num(d["repairs"] ?? d["estimated_repairs"]) ?? 0,
    sqft: num(d["sqft"] ?? d["living_area"]),
    beds: num(d["beds"] ?? d["bedrooms"]),
    baths: num(d["baths"] ?? d["bathrooms"]),
    year_built: num(d["year_built"] ?? d["yearbuilt"]),
    acreage: num(d["acreage"] ?? d["lot_acres"]),
    asset_type: pick(d, ["asset_type", "property_type"]) ?? "SFR",
  };
}

/** Ingest a batch of raw property payloads. Never throws. */
export async function ingestAssets(
  rawList: any[],
  source = "pipeline_ingest",
): Promise<IngestResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const list = (rawList ?? []).slice(0, 500);
  let inserted = 0;
  let deduped = 0;
  let dlq = 0;
  const ids: string[] = [];

  for (const d of list) {
    try {
      const a = normalizeAsset(d ?? {});
      if (!a.zip || !/^\d{5}$/.test(a.zip) || !a.price) {
        dlq++;
        await supabaseAdmin.from("dead_letter_queue").insert({
          raw_payload: d as any,
          source_ip: source,
          error_reason: "missing_zip_or_price",
        } as never);
        continue;
      }

      // Title/deal-tape integrity hash — deterministic per parcel + economics.
      const hash = await sha256Hex(
        `${source}:${a.apn ?? ""}:${a.address ?? ""}:${a.zip}:${a.price}`,
      );

      const { error: dupErr } = await supabaseAdmin
        .from("ingest_idempotency_keys")
        .insert({ hash, source } as never);
      if (dupErr) {
        deduped++;
        continue;
      }

      // Institutional ledger routing + BTR/ESG compliance tagging at ingest.
      const { classifyBtr } = await import("@/lib/btr-routing");
      const cls = classifyBtr({
        valuation: a.price,
        parcel_number: a.apn,
        apn: a.apn,
        city: a.city,
        state: a.state,
        county: a.county,
        address: a.address,
        asset_type: a.asset_type,
        acreage: a.acreage,
      });

      // Commercial taxonomy + institutional metrics at ingest.
      const { enrichCre } = await import("@/lib/cre-taxonomy");
      const cre = enrichCre({ ...d, ...a, base_contract_price: a.price });

      const { data: row, error: insErr } = await supabaseAdmin
        .from("closing_pipeline_items")
        .insert({
          enrichment_tags: Array.from(new Set([...(cls.tags ?? []), ...cre.tags])),
          zip: a.zip,
          address: a.address,
          city: a.city,
          state: a.state,
          county: a.county,
          apn: a.apn,
          parcel_number: a.apn,
          base_contract_price: a.price,
          assessed_value: a.assessed_value,
          estimated_repairs: a.estimated_repairs,
          sqft: a.sqft,
          beds: a.beds,
          baths: a.baths,
          year_built: a.year_built,
          acreage: a.acreage,
          asset_type: a.asset_type,
          cre_class: cre.cre_class,
          fee_bps: cre.fee_bps || null,
          expense_ratio: cre.expense_ratio,
          noi_usd: cre.noi_usd,
          estimated_cap_rate: cre.estimated_cap_rate,
          walt_years: cre.walt_years,
          tenant_credit_tier: cre.tenant_credit_tier,
          debt_maturity_date: cre.debt_maturity_date,
          debt_distress_flag: cre.debt_distress_flag,
          debt_distress_reason: cre.debt_distress_reason,
          far_potential: cre.far_potential,
          adaptive_reuse_by_right: cre.adaptive_reuse_by_right,
          env_status: cre.env_status,
          env_flag_reason: cre.env_flag_reason,
          cre_lane: cre.cre_lane,
          optimized_acquisition_premium:
            cre.cre_class !== "NON_COMMERCIAL" && cre.target_fee_usd > 0
              ? cre.target_fee_usd
              : null,
          status: "Pending-Underwriting",
          source,
          idempotency_key: hash,
          m2m_asset_hash: hash,
        } as never)
        .select("id")
        .maybeSingle();


      if (insErr) {
        dlq++;
        await supabaseAdmin.from("dead_letter_queue").insert({
          raw_payload: d as any,
          source_ip: source,
          error_reason: insErr.message,
        } as never);
        continue;
      }
      inserted++;
      if ((row as any)?.id) ids.push((row as any).id);
    } catch (e) {
      dlq++;
      console.error("[ingest] row failed", (e as Error).message);
    }
  }

  try {
    await supabaseAdmin.from("ingest_runs").insert({
      source,
      status: "ok",
      total_rows: list.length,
      inserted,
      deduped,
      dlq,
    } as never);
  } catch {
    /* fail-forward */
  }

  return { ok: true, source, total: list.length, inserted, deduped, dlq, ids };
}

/** Coerce any payload shape into an array of property records. */
export function extractList(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.deals)) return raw.deals;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.properties)) return raw.properties;
  if (raw && typeof raw === "object") return [raw];
  return [];
}
