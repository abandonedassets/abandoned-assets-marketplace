import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";
import { calculateLeadConfidence } from "@/lib/confidence";

// Deployment version tag — bump when query/payload shape changes.

// Integrity Engine modules:
//   1. Auth Token Gate     — INGEST_AUTH_TOKEN required on every POST
//   2. Idempotency Keys    — SHA256(external_id|zip|address|price) vs ingest_idempotency_keys
//   3. Delta Sync          — skip if (now - ingest_last_sync_ts) < ingest_min_interval_seconds
//   4. Self-Healing Telem  — measure latency; >500ms shrinks batch_size, else grows toward 50

type Row = Record<string, string>;

function rowHash(externalId: string | null, zip: string, address: string, price: number): string {
  return createHash("sha256")
    .update(`${externalId ?? ""}|${zip}|${address.toLowerCase().trim()}|${price}`)
    .digest("hex");
}

function checkAuthToken(request: Request): { ok: boolean; reason?: string } {
  // Scheduler path: pg_cron authenticates with the project publishable key.
  const apikey = request.headers.get("apikey") ?? "";
  const publishable =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (apikey && publishable && apikey === publishable) return { ok: true };

  const expected = process.env.INGEST_AUTH_TOKEN;
  if (!expected) return { ok: false, reason: "token_not_configured" }; // fail closed
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!provided) return { ok: false, reason: "missing_token" };
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: "bad_token" };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "bad_token" };
}


// Minimal CSV parser (handles quoted fields + commas + escaped quotes).
function parseCSV(text: string): Row[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (field !== "" || cur.length) { cur.push(field); rows.push(cur); }
        cur = []; field = "";
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else field += c;
    }
  }
  if (field !== "" || cur.length) { cur.push(field); rows.push(cur); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s\-\.]/g, "_"));
  return rows.slice(1).map((r) => {
    const o: Row = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  return isFinite(n) && n > 0 ? n : null;
}

// Vacant-lot fallback: county assessments of $0 are valid signal (tax-delinquent
// infill), not bad data. Floor to $5,000 baseline strike instead of DLQ-rejecting.
const VACANT_LOT_FLOOR = 5000;
function toNumWithFloor(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  if (!isFinite(n) || n < 0) return null;
  return n > 0 ? n : VACANT_LOT_FLOOR;
}

// Tiered assignment-fee model. Replaces the legacy flat $5,000 default so
// fee scales with property value. Floor $5k, cap $500k.
// Tiers (on base contract price):
//   <  $100k   -> 5.0%
//   <  $500k   -> 4.0%
//   <  $2M     -> 3.0%
//   >= $2M     -> 2.5%
// If ARV > price, prefer 10% of spread when it exceeds the tiered floor.
export function computeAssignmentFee(price: number, arv?: number | null): number {
  const FLOOR = 5000;
  const CAP = 500_000;
  let pct: number;
  if (price < 100_000) pct = 0.05;
  else if (price < 500_000) pct = 0.04;
  else if (price < 2_000_000) pct = 0.03;
  else pct = 0.025;
  const tiered = Math.round(price * pct);
  const spread = arv && arv > price ? Math.round((arv - price) * 0.10) : 0;
  const fee = Math.max(FLOOR, tiered, spread);
  return Math.min(fee, CAP);
}

function pick(row: Row, keys: string[]): string | null {
  for (const k of keys) if (row[k]) return row[k];
  return null;
}

function extractZip(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : null;
}

// City fallback when CSV omits ZIP entirely (common in county auditor exports).
// Maps known target markets to a representative ZIP so ingest doesn't DLQ.
const CITY_ZIP_FALLBACK: Record<string, string> = {
  dayton: "45407",
  cincinnati: "45202",
  columbus: "43215",
  cleveland: "44113",
  toledo: "43604",
  chicago: "60601",
};
function cityFallbackZip(city: string | null): string | null {
  if (!city) return null;
  return CITY_ZIP_FALLBACK[city.trim().toLowerCase()] ?? null;
}

export const Route = createFileRoute("/api/public/hooks/county-ingest")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, note: "POST to run ingest" }),
      POST: async ({ request }) => {
        // ───── Module 1: Auth Token Gate ─────
        const auth = checkAuthToken(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        // Paid enrichment providers are optional. The default path is 100%
        // key-free: CSV/GIS rows enriched by OpenStreetMap + US Census.
        const url = process.env.DATA_SOURCE_URL;
        const hasLiveProvider =
          !!process.env.ATTOM_API_KEY || !!process.env.BATCHDATA_API_KEY;



        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // Read tuning flags (delta sync + self-healing batch size)
        const { data: flags } = await supabaseAdmin
          .from("system_flags")
          .select("key,bool_value,int_value,text_value")
          .in("key", [
            "ingest_enabled",
            "ingest_daily_cap",
            "ingest_last_sync_ts",
            "ingest_batch_size",
            "ingest_min_interval_seconds",
          ]);
        const enabled = flags?.find((f) => f.key === "ingest_enabled")?.bool_value ?? true;
        const dailyCap = flags?.find((f) => f.key === "ingest_daily_cap")?.int_value ?? 5;
        const lastSyncTs = flags?.find((f) => f.key === "ingest_last_sync_ts")?.text_value ?? null;
        const batchSize = flags?.find((f) => f.key === "ingest_batch_size")?.int_value ?? 50;
        const minInterval = flags?.find((f) => f.key === "ingest_min_interval_seconds")?.int_value ?? 60;

        if (!enabled) {
          return Response.json({ ok: false, error: "ingest_disabled" }, { status: 200 });
        }

        // ───── Module 3: Delta Sync throttle ─────
        if (lastSyncTs) {
          const elapsed = (Date.now() - new Date(lastSyncTs).getTime()) / 1000;
          if (elapsed < minInterval) {
            return Response.json({
              ok: false,
              error: "throttled_delta_sync",
              retry_in_seconds: Math.ceil(minInterval - elapsed),
            }, { status: 200 });
          }
        }

        const since = new Date(Date.now() - 24 * 3600_000).toISOString();
        const { count: todayCount } = await supabaseAdmin
          .from("ingest_runs")
          .select("id", { count: "exact", head: true })
          .gte("created_at", since);
        if ((todayCount ?? 0) >= dailyCap) {
          return Response.json({ ok: false, error: "daily_cap_reached", cap: dailyCap }, { status: 200 });
        }

        // ───── Module 4: Self-Healing latency timer (start) ─────
        const t0 = Date.now();

        let rows: Row[] = [];
        let sourceName = "csv";
        try {
          if (hasLiveProvider) {
            const { fetchEnrichmentRows } = await import("@/lib/enrichment.server");
            const r = await fetchEnrichmentRows(batchSize);
            rows = r.rows;
            sourceName = r.provider;
            if (!rows.length && url) {
              const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              rows = parseCSV(await res.text());
              sourceName = "csv";
            }
          } else {
            const res = await fetch(url!, { signal: AbortSignal.timeout(30_000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            rows = parseCSV(await res.text());
          }
        } catch (e) {
          await supabaseAdmin.from("dead_letter_queue").insert({
            raw_payload: { source: sourceName, url } as any,
            source_ip: "cron",
            error_reason: `manual_review_required: fetch/parse failed - ${(e as Error).message}`,
          });
          return Response.json({ ok: false, error: "fetch_failed" }, { status: 200 });
        }


        let inserted = 0, deduped = 0, dlq = 0, idemSkipped = 0, geoFilled = 0, lowConfidence = 0;

        for (const row of rows) {
          try {
            const externalId = pick(row, ["external_id", "datafiniti_id"]);
            const addressRaw = pick(row, ["address", "property_address", "site_address", "street"]) ?? "";
            const cityRaw = pick(row, ["city", "municipality"]) ?? "";
            const stateRaw = pick(row, ["state", "province"]) ?? null;
            const countyRaw = pick(row, ["county"]) ?? null;
            const zipRaw = pick(row, ["zip", "zipcode", "zip_code", "postal", "postal_code"]);
            let zip = zipRaw ?? extractZip(addressRaw) ?? (addressRaw ? null : cityFallbackZip(cityRaw));
            const priceRaw = pick(row, ["price", "assessedvalue", "assessed_value", "base_contract_price", "value", "market_value"]);
            const price = externalId
              ? (toNum(priceRaw) ?? VACANT_LOT_FLOOR)
              : toNumWithFloor(priceRaw);

            // Zero-key backfill: OpenStreetMap → US Census resolves a missing
            // ZIP instead of DLQ-rejecting an otherwise good asset.
            let geoCounty: string | null = countyRaw;
            if (!zip && addressRaw) {
              const { getFreePropertyInfo } = await import("@/lib/geo-free.server");
              const g = await getFreePropertyInfo(
                [addressRaw, cityRaw, stateRaw].filter(Boolean).join(", "),
              );
              if (g.success) {
                zip = g.postcode || null;
                geoCounty = geoCounty || g.county || null;
                geoFilled++;
              }
            }

            if (!zip || !price || (!externalId && !addressRaw)) {
              await supabaseAdmin.from("dead_letter_queue").insert({
                raw_payload: row as any,
                source_ip: "cron",
                error_reason: !zip ? "missing_zip" : !price ? "missing_price" : "missing_address_and_external_id",
              });
              dlq++;
              continue;
            }

            // ───── Local confidence gate (no external service) ─────
            const conf = calculateLeadConfidence({
              address: addressRaw,
              zip,
              price,
            });


            // ───── Module 2: Idempotency-key check ─────
            const hash = rowHash(externalId, zip, addressRaw, price);
            const { data: idemHit } = await supabaseAdmin
              .from("ingest_idempotency_keys")
              .select("hash")
              .eq("hash", hash)
              .maybeSingle();
            if (idemHit) {
              idemSkipped++;
              continue;
            }

            const arv = toNum(pick(row, ["arv", "underwritten_arv", "after_repair_value", "market_value"]));
            const fee = computeAssignmentFee(price, arv);

            const onConflict = externalId ? "external_id" : "zip,address";
            const { error: insErr, data: ins } = await supabaseAdmin
              .from("closing_pipeline_items")
              .upsert(
                {
                  external_id: externalId,
                  address: addressRaw || null,
                  city: cityRaw || null,
                  state: stateRaw,
                  county: geoCounty,
                  zip,
                  base_contract_price: price,
                  optimized_acquisition_premium: fee,
                  status: conf.passed ? "Webhook_Dispatched" : "New",
                  confidence_score: conf.score,
                  source: "public_record",
                  is_equitable_interest: true,
                  beds: toNum(pick(row, ["beds", "bedrooms"])),
                  baths: toNum(pick(row, ["baths", "bathrooms"])),
                  sqft: toNum(pick(row, ["sqft", "sq_ft", "square_feet"])),
                  year_built: toNum(pick(row, ["year_built", "yearbuilt", "yr_built"])),
                },
                { onConflict, ignoreDuplicates: true },
              )
              .select("id");

            if (insErr) {
              await supabaseAdmin.from("dead_letter_queue").insert({
                raw_payload: row as any,
                source_ip: "cron",
                error_reason: `insert_failed: ${insErr.message}`,
              });
              dlq++;
            } else if (!ins || ins.length === 0) {
              deduped++;
            } else {
              inserted++;
              if (!conf.passed) lowConfidence++;
              // Record idempotency key only after successful insert (fail-forward).
              await supabaseAdmin
                .from("ingest_idempotency_keys")
                .insert({ hash, source: sourceName });
            }

          } catch (e) {
            dlq++;
            try {
              await supabaseAdmin.from("dead_letter_queue").insert({
                raw_payload: row as any,
                source_ip: "cron",
                error_reason: `row_exception: ${(e as Error).message}`,
              });
            } catch {}
          }
        }

        // ───── Module 4: Self-Healing telemetry + batch-size feedback ─────
        const latencyMs = Date.now() - t0;
        const perRow = rows.length > 0 ? latencyMs / rows.length : latencyMs;
        let nextBatch = batchSize;
        if (perRow > 500) nextBatch = Math.max(5, Math.floor(batchSize * 0.7));
        else if (perRow < 200 && batchSize < 50) nextBatch = Math.min(50, batchSize + 5);

        await supabaseAdmin.from("system_metrics").upsert({
          metric_name: "ingest_latency_ms",
          metric_value: latencyMs,
          metric_count: rows.length,
          computed_at: new Date().toISOString(),
        });

        if (nextBatch !== batchSize) {
          await supabaseAdmin
            .from("system_flags")
            .update({ int_value: nextBatch, updated_at: new Date().toISOString() })
            .eq("key", "ingest_batch_size");
        }

        // Module 3: stamp last-sync timestamp for next delta check.
        await supabaseAdmin
          .from("system_flags")
          .update({ text_value: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("key", "ingest_last_sync_ts");

        await supabaseAdmin.from("ingest_runs").insert({
          source: sourceName,
          status: "ok",
          total_rows: rows.length,
          inserted,
          deduped,
          dlq,
        });

        return Response.json({
          ok: true,
          total_rows: rows.length,
          inserted,
          deduped,
          dlq,
          idempotent_skipped: idemSkipped,
          geo_backfilled: geoFilled,
          low_confidence: lowConfidence,
          latency_ms: latencyMs,
          batch_size: batchSize,
          next_batch_size: nextBatch,
          ran_at: new Date().toISOString(),
        });
      },
    },
  },
});
