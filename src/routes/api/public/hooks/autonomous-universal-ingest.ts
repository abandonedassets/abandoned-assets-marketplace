import { createFileRoute } from "@tanstack/react-router";

// Pass I — Autonomous Liquidity Clearinghouse: Universal Ingestion.
// Asset-agnostic. Pulls ALL property records, computes a spread vs.
// neighborhood (ZIP) sales, ingests anything >= $10k margin floor,
// and auto-generates 1031-ACTIVE buyer buy-boxes from owners showing
// >5 purchases in 12 months. Fail-forward: always returns 200.

const DEFAULT_GIS_URL =
  "https://maps.mcohio.org/arcgis/rest/services/Auditor/Parcels/MapServer/0/query";

type Feat = { attributes: Record<string, any> };

function pickAttr(a: Record<string, any>, keys: string[]): string | null {
  for (const k of keys) {
    const v = a[k] ?? a[k.toUpperCase()] ?? a[k.toLowerCase()];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}
function extractZip(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : null;
}
function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  return isFinite(n) && n > 0 ? n : null;
}
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400_000);
}

export const Route = createFileRoute("/api/public/hooks/autonomous-universal-ingest")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, note: "POST to run universal ingest" }),
      POST: async () => {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        let gisUrl: string = process.env.GIS_ARCGIS_URL || DEFAULT_GIS_URL;
        try {
          const { data: cfg } = await supabaseAdmin
            .from("system_config")
            .select("value")
            .eq("key", "ACTIVE_GIS_URL")
            .maybeSingle();
          if (cfg && typeof (cfg as any).value === "string" && (cfg as any).value) {
            gisUrl = (cfg as any).value;
          }
        } catch {}

        const { data: flags } = await supabaseAdmin
          .from("system_flags")
          .select("key,bool_value")
          .eq("key", "ingest_enabled");
        const enabled = flags?.[0]?.bool_value ?? true;
        if (!enabled) {
          return Response.json({ ok: false, error: "ingest_disabled" }, { status: 200 });
        }

        // Fetch ArcGIS — Circuit Breaker: exponential backoff (1s/2s/4s/8s)
        // before DLQ + API_FAILOVER alert. Catches 401/403/429/5xx without
        // dropping payload.
        let features: Feat[] = [];
        const backoffMs = [1000, 2000, 4000, 8000];
        let lastErr = "";
        let lastStatus = 0;
        let fetched = false;
        for (let attempt = 0; attempt < backoffMs.length; attempt++) {
          try {
            const u = new URL(gisUrl);
            u.searchParams.set("where", "1=1");
            u.searchParams.set("outFields", "*");
            u.searchParams.set("returnGeometry", "false");
            u.searchParams.set("f", "json");
            u.searchParams.set("resultRecordCount", "1000");
            const res = await fetch(u.toString(), {
              signal: AbortSignal.timeout(45_000),
            });
            lastStatus = res.status;
            if (!res.ok) {
              const retryable = res.status === 429 || res.status === 401 || res.status === 403 || res.status >= 500;
              lastErr = `HTTP ${res.status}`;
              if (!retryable) throw new Error(lastErr);
              if (attempt < backoffMs.length - 1) {
                await new Promise((r) => setTimeout(r, backoffMs[attempt]));
                continue;
              }
              throw new Error(lastErr);
            }
            const json: any = await res.json();
            features = Array.isArray(json?.features) ? json.features : [];
            fetched = true;
            break;
          } catch (e) {
            lastErr = (e as Error).message;
            if (attempt < backoffMs.length - 1) {
              await new Promise((r) => setTimeout(r, backoffMs[attempt]));
              continue;
            }
          }
        }
        if (!fetched) {
          // Persist payload context to DLQ for later retry by dlq-retry cron.
          await supabaseAdmin.from("dead_letter_queue").insert({
            raw_payload: {
              source: "arcgis-universal",
              url: gisUrl,
              last_status: lastStatus,
              attempts: backoffMs.length,
            } as any,
            source_ip: "cron",
            error_reason: `gis_fetch_failed_after_backoff: ${lastErr}`,
          });
          // Fire API_FAILOVER alert so the operator sees the upstream outage.
          await supabaseAdmin.from("system_alerts").insert({
            kind: "API_FAILOVER",
            severity: "critical",
            message: `Primary GIS ingest API unavailable after exponential backoff (${backoffMs.length} attempts).`,
            metadata: {
              route: "autonomous-universal-ingest",
              gis_url: gisUrl,
              last_status: lastStatus,
              last_error: lastErr,
            } as any,
          });
          return Response.json(
            { ok: false, error: "fetch_failed", dlq: true, alert: "API_FAILOVER" },
            { status: 200 },
          );
        }

        // Build per-ZIP sale comps (neighborhood valuation reference)
        const zipSales = new Map<string, number[]>();
        // Build owner -> purchases (12mo) and most recent sale-out date
        const ownerPurchases = new Map<string, number>();
        const ownerLastSale = new Map<string, string>();

        for (const f of features) {
          const a = f.attributes ?? {};
          const owner = pickAttr(a, ["OWNER_NAME", "OwnerName", "owner", "OWNER1"]);
          const xferDate = pickAttr(a, ["TRANSFER_DATE", "SALE_DATE", "LastSaleDate"]);
          const salePrice = toNum(
            pickAttr(a, ["SALE_PRICE", "LAST_SALE_PRICE", "TRANSFER_AMOUNT"]),
          );
          const zip =
            pickAttr(a, ["SITE_ZIP", "PROPERTY_ZIP", "ZIP", "PostalCode"]) ??
            extractZip(pickAttr(a, ["SITE_ADDRESS", "ADDRESS", "Address"]));

          if (zip && salePrice) {
            const arr = zipSales.get(zip) ?? [];
            arr.push(salePrice);
            zipSales.set(zip, arr);
          }
          if (owner) {
            const d = daysSince(xferDate);
            if (d != null && d <= 365) {
              ownerPurchases.set(owner, (ownerPurchases.get(owner) ?? 0) + 1);
              const cur = ownerLastSale.get(owner);
              if (!cur || (xferDate && xferDate > cur)) {
                ownerLastSale.set(owner, xferDate!);
              }
            }
          }
        }

        const zipMedian = new Map<string, number>();
        for (const [z, arr] of zipSales.entries()) {
          arr.sort((a, b) => a - b);
          zipMedian.set(z, arr[Math.floor(arr.length / 2)]);
        }

        let ingested = 0,
          skippedLowSpread = 0,
          deduped = 0,
          dlq = 0,
          buyersCreated = 0;

        // Pass A: ingest properties hitting the $10k margin floor
        for (const f of features) {
          try {
            const a = f.attributes ?? {};
            const owner =
              pickAttr(a, ["OWNER_NAME", "OwnerName", "owner", "OWNER1"]) ?? "";
            const propAddr = pickAttr(a, [
              "SITE_ADDRESS",
              "PROPERTY_ADDRESS",
              "ADDRESS",
              "Address",
            ]);
            const propZip =
              pickAttr(a, ["SITE_ZIP", "PROPERTY_ZIP", "ZIP", "PostalCode"]) ??
              extractZip(propAddr);
            if (!propZip) continue;

            const taxZip =
              pickAttr(a, ["TAX_ZIP", "MAIL_ZIP", "MAILING_ZIP", "OwnerZip"]) ??
              extractZip(pickAttr(a, ["TAX_ADDRESS", "MAIL_ADDRESS", "MAILING_ADDRESS"]));
            const propType = (
              pickAttr(a, ["PROPERTY_TYPE", "LAND_USE", "ASSET_TYPE", "USE_CODE"]) ?? ""
            ).toLowerCase();
            const inspDays = daysSince(
              pickAttr(a, ["LAST_INSPECTION_DATE", "LastInspection", "PERMIT_LAST_INSPECTION"]),
            );

            const assessed =
              toNum(pickAttr(a, ["ASSESSED_VALUE", "MARKET_VALUE", "APPRAISED_VALUE"])) ?? 0;
            const comp = zipMedian.get(propZip) ?? 0;
            const valuation = comp > 0 ? comp : assessed;
            if (!valuation) continue;

            // Distress signals
            const isLLC = /\b(LLC|L\.L\.C\.|LP|L\.P\.)\b/i.test(owner);
            const isCommercialOrMulti =
              /commercial|multi|apartment|pad|industrial|retail/i.test(propType);
            const dipFlags: string[] = [];
            if (isLLC) dipFlags.push("LLC");
            if (isCommercialOrMulti && inspDays != null && inspDays > 180)
              dipFlags.push("STALLED-DEVELOPMENT");
            if (propZip && taxZip && propZip !== taxZip) dipFlags.push("1031-PROBABLE");
            const isDIP = dipFlags.length > 0;
            const spreadMultiplier = isDIP ? 1.5 : 1.0;

            // Base raw spread vs neighborhood comp (assessed under-valued vs sales)
            const rawSpread = Math.max(0, valuation - assessed);
            // Fee = max(raw spread * multiplier, 10% of acquisition price)
            const baseFee = Math.round(
              Math.max(rawSpread * spreadMultiplier, assessed * 0.1),
            );

            if (baseFee < 10000) {
              skippedLowSpread++;
              continue;
            }

            const spreadScore = Math.round(baseFee);
            const yieldClass = isDIP ? "DIP" : "Standard-Yield";

            let assetType = "SFR";
            if (/multi|apartment/i.test(propType)) assetType = "Multi-Family";
            else if (/commercial|pad|retail/i.test(propType)) assetType = "Commercial-Pad";
            else if (/vacant|lot|infill/i.test(propType)) assetType = "Infill-Lot";

            const externalId = pickAttr(a, ["PARCEL_ID", "PARCELID", "PIN", "OBJECTID"]);
            const acquisitionPrice = assessed || valuation * 0.7;
            const tagSuffix = `[${yieldClass}${dipFlags.length ? "|" + dipFlags.join(",") : ""}]`;
            const addressWithTag = propAddr
              ? `${propAddr} ${tagSuffix}`
              : tagSuffix;
            const onConflict = externalId ? "external_id" : "zip,address";

            const { error: insErr, data: ins } = await supabaseAdmin
              .from("closing_pipeline_items")
              .upsert(
                {
                  external_id: externalId ? `gis-uni:${externalId}` : null,
                  address: addressWithTag,
                  zip: propZip,
                  state: "OH",
                  county: pickAttr(a, ["COUNTY"]) ?? "Montgomery",
                  base_contract_price: Math.round(acquisitionPrice),
                  optimized_acquisition_premium: baseFee,
                  asset_type: assetType,
                  status: "New",
                  source: "gis_universal",
                  is_equitable_interest: true,
                  spread_score: spreadScore,
                  spread_multiplier: spreadMultiplier,
                  yield_class: yieldClass,
                } as any,
                { onConflict, ignoreDuplicates: true },
              )
              .select("id");

            if (insErr) {
              dlq++;
              await supabaseAdmin.from("dead_letter_queue").insert({
                raw_payload: { yieldClass, attrs: a } as any,
                source_ip: "cron",
                error_reason: `uni_insert_failed: ${insErr.message}`,
              });
            } else if (!ins || ins.length === 0) {
              deduped++;
            } else {
              ingested++;
            }
          } catch (e) {
            dlq++;
            try {
              await supabaseAdmin.from("dead_letter_queue").insert({
                raw_payload: f.attributes as any,
                source_ip: "cron",
                error_reason: `uni_row_exception: ${(e as Error).message}`,
              });
            } catch {}
          }
        }

        // Pass B: 1031-Clearinghouse — auto-build buyer buy-boxes from
        // high-velocity institutional owners. The buyer is a synthetic uuid
        // derived deterministically from the owner name (gen_random_uuid-style
        // via sha-256 hex slice). They are pseudo-buyers used by the
        // Orange Square matcher; real auth-users override via existing flow.
        const enc = new TextEncoder();
        for (const [owner, count] of ownerPurchases.entries()) {
          if (count <= 5) continue;
          try {
            const hashBuf = await crypto.subtle.digest("SHA-256", enc.encode(owner));
            const hex = Array.from(new Uint8Array(hashBuf))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
            const buyerId =
              `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
            const lastSale = ownerLastSale.get(owner);
            const lastSaleDate = lastSale ? new Date(lastSale) : new Date();
            const windowExp = new Date(lastSaleDate.getTime() + 90 * 86400_000);
            const isActive = Date.now() - lastSaleDate.getTime() < 90 * 86400_000;
            const priority = isActive ? "1031-ACTIVE" : "INSTITUTIONAL-BUYER";

            // Build target_zips from where this owner buys; cap at 25
            const zips = new Set<string>();
            for (const f of features) {
              const a = f.attributes ?? {};
              const o = pickAttr(a, ["OWNER_NAME", "OwnerName", "owner", "OWNER1"]);
              if (o !== owner) continue;
              const z =
                pickAttr(a, ["SITE_ZIP", "PROPERTY_ZIP", "ZIP", "PostalCode"]) ??
                extractZip(pickAttr(a, ["SITE_ADDRESS", "ADDRESS"]));
              if (z) zips.add(z);
              if (zips.size >= 25) break;
            }
            if (zips.size === 0) continue;

            // Max contract = 2x median assessed in their zips (approx high-volume cap)
            let maxPx = 0;
            for (const z of zips) maxPx = Math.max(maxPx, zipMedian.get(z) ?? 0);
            maxPx = Math.max(maxPx * 2, 250000);

            const { data: existing } = await supabaseAdmin
              .from("buyer_buy_boxes")
              .select("id")
              .eq("buyer_id", buyerId)
              .eq("label", `auto:${owner}`)
              .maybeSingle();

            if (existing) {
              await supabaseAdmin
                .from("buyer_buy_boxes")
                .update({
                  active: true,
                  deprecated_at: null,
                  buyer_priority: priority,
                  window_expiration: windowExp.toISOString(),
                  last_sale_at: lastSaleDate.toISOString(),
                  target_zip_codes: Array.from(zips),
                  max_contract_price: Math.round(maxPx),
                } as any)
                .eq("id", (existing as any).id);
            } else {
              const { error: bbErr } = await supabaseAdmin
                .from("buyer_buy_boxes")
                .insert({
                  buyer_id: buyerId,
                  label: `auto:${owner}`,
                  target_asset_types: ["SFR", "Multi-Family", "Commercial-Pad", "Infill-Lot"],
                  target_zip_codes: Array.from(zips),
                  max_contract_price: Math.round(maxPx),
                  min_placement_margin: 10000,
                  active: true,
                  buyer_priority: priority,
                  window_expiration: windowExp.toISOString(),
                  last_sale_at: lastSaleDate.toISOString(),
                } as any);
              if (!bbErr) buyersCreated++;
            }
          } catch (e) {
            try {
              await supabaseAdmin.from("dead_letter_queue").insert({
                raw_payload: { owner, count } as any,
                source_ip: "cron",
                error_reason: `buyer_autocreate_failed: ${(e as Error).message}`,
              });
            } catch {}
          }
        }

        await supabaseAdmin.from("ingest_runs").insert({
          source: "arcgis_universal",
          status: "ok",
          total_rows: features.length,
          inserted: ingested,
          deduped,
          dlq,
        });

        return Response.json({
          ok: true,
          total_features: features.length,
          ingested,
          skipped_low_spread: skippedLowSpread,
          deduped,
          dlq,
          buyers_created: buyersCreated,
          ran_at: new Date().toISOString(),
        });
      },
    },
  },
});
