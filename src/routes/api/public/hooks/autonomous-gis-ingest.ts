import { createFileRoute } from "@tanstack/react-router";
import { detectQualifiedIntermediary, exchangeWindow } from "@/lib/qi";
import { calculateLeadConfidence } from "@/lib/confidence";


// Pass F — Autonomous GIS Ingestion + Institutional Distress Heuristics.
// Queries a public ArcGIS REST FeatureServer (Montgomery County OH by default),
// applies 3 heuristics (LLC-LIQUIDATION-SIGNAL, STALLED-DEVELOPMENT, 1031-PROBABLE),
// and upserts tagged properties into closing_pipeline_items. The Pass E
// match_orange_squares trigger fires automatically on insert.
//
// Fail-forward: all errors logged to dead_letter_queue; always returns 200.

// Multiplexed municipal GIS matrix — direct county/city FeatureServers, no
// third-party subscription. Each entry is harvested independently; one dead
// endpoint never stalls the others (fail-forward).
const DEFAULT_GIS_SOURCES = [
  "https://services.arcgis.com/ue9rwulIoeLEI9bj/arcgis/rest/services/Parcels/FeatureServer/0/query",
  "https://services.arcgis.com/ewjSqmSyHJnkfBLL/arcgis/rest/services/Parcels_open_data/FeatureServer/0/query",
];

// Fallback state code per GIS host (used when the layer has no STATE field).
const HOST_STATE: Record<string, string> = {
  "gis.cuyahogacounty.us": "OH",
  "gis.cuyahogacounty.gov": "OH",
};

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
  // ZIP+4 published unpadded ("800052024") has no word boundary at 5 digits.
  const nine = s.match(/\b(\d{5})(\d{4})\b/);
  if (nine) return nine[1]!;
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
  // ArcGIS date fields are frequently epoch milliseconds, not ISO strings.
  const t = /^\d{10,}$/.test(iso) ? Number(iso) : Date.parse(iso);
  if (!isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400_000);
}

export const Route = createFileRoute("/api/public/hooks/autonomous-gis-ingest")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, note: "POST to run GIS ingest" }),
      POST: async () => {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // Adaptive ingestion: ACTIVE_GIS_SOURCES (JSON array) or legacy
        // ACTIVE_GIS_URL from system_config; else the built-in county matrix.
        let sources: string[] = (process.env.GIS_ARCGIS_URL || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        try {
          const { data: cfgs } = await supabaseAdmin
            .from("system_config")
            .select("key,value")
            .in("key", ["ACTIVE_GIS_SOURCES", "ACTIVE_GIS_URL"]);
          const multi = (cfgs ?? []).find((c: any) => c.key === "ACTIVE_GIS_SOURCES")?.value;
          const single = (cfgs ?? []).find((c: any) => c.key === "ACTIVE_GIS_URL")?.value;
          if (typeof multi === "string" && multi.trim()) {
            try {
              const arr = JSON.parse(multi);
              if (Array.isArray(arr)) sources = arr.filter((x) => typeof x === "string" && x);
            } catch {
              sources = multi.split(",").map((s: string) => s.trim()).filter(Boolean);
            }
          } else if (typeof single === "string" && single) {
            sources = [single];
          }
        } catch {
          /* fall back to env/default */
        }
        if (sources.length === 0) sources = DEFAULT_GIS_SOURCES;

        // Kill switch reuses existing ingest_enabled flag.
        const { data: flags } = await supabaseAdmin
          .from("system_flags")
          .select("key,bool_value")
          .eq("key", "ingest_enabled");
        const enabled = flags?.[0]?.bool_value ?? true;
        if (!enabled) {
          return Response.json({ ok: false, error: "ingest_disabled" }, { status: 200 });
        }

        let tagged = 0,
          inserted = 0,
          deduped = 0,
          dlq = 0,
          totalFeatures = 0;
        const perSource: Array<{ url: string; features: number; error?: string }> = [];

        for (const gisUrl of sources) {
        // Query ArcGIS FeatureServer — request JSON, all fields, geometry off.
        let features: Feat[] = [];
        try {
          const u = new URL(gisUrl);
          u.searchParams.set("where", "1=1");
          u.searchParams.set("outFields", "*");
          u.searchParams.set("returnGeometry", "false");
          u.searchParams.set("f", "json");
          u.searchParams.set("resultRecordCount", "500");
          const res = await fetch(u.toString(), {
            signal: AbortSignal.timeout(45_000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json: any = await res.json();
          features = Array.isArray(json?.features) ? json.features : [];
        } catch (e) {
          perSource.push({ url: gisUrl, features: 0, error: (e as Error).message });
          await supabaseAdmin.from("dead_letter_queue").insert({
            raw_payload: { source: "arcgis", url: gisUrl } as any,
            source_ip: "cron",
            error_reason: `gis_fetch_failed: ${(e as Error).message}`,
          });
          continue;
        }

        // Pass 1: build owner -> recent transfer count map for LLC-LIQUIDATION signal.
        const ownerTransfers = new Map<string, number>();
        for (const f of features) {
          const a = f.attributes ?? {};
          const owner = pickAttr(a, [
            "OWNER_NAME",
            "OwnerName",
            "owner",
            "OWNER1",
            "deeded_owner",
            "OWN_NAME",
            "Owner",
          ]);
          const xferDate = pickAttr(a, [
            "TRANSFER_DATE",
            "SALE_DATE",
            "LastSaleDate",
            "transfer_date",
          ]);
          if (!owner) continue;
          const d = daysSince(xferDate);
          if (d != null && d <= 180) {
            ownerTransfers.set(owner, (ownerTransfers.get(owner) ?? 0) + 1);
          }
        }




        for (const f of features) {
          try {
            const a = f.attributes ?? {};
            const owner =
              pickAttr(a, [
                "OWNER_NAME",
                "OwnerName",
                "owner",
                "OWNER1",
                "NAME",
                "TAXPAYER",
                "deeded_owner",
                "mail_name",
                "OWN_NAME",
                "Owner",
                "OWNER",
              ]) ?? "";
            const propAddr = pickAttr(a, [
              "SITUS_AD_1",
              "SITUS",
              "SITE_ADDRESS",
              "PROPERTY_ADDRESS",
              "ADDRESS",
              "Address",
              "par_addr_all",
              "PHY_ADDR1",
            ]);
            const propZip =
              extractZip(
                pickAttr(a, [
                  "SITUS_ZIP",
                  "SITE_ZIP",
                  "PROPERTY_ZIP",
                  "ZIP",
                  "ZIPCODE",
                  "PostalCode",
                  "par_zip",
                  "PHY_ZIPCD",
                ]),
              ) ?? extractZip(propAddr);
            const taxZip =
              extractZip(
                pickAttr(a, [
                  "OWNER_ZIP",
                  "TAX_ZIP",
                  "MAIL_ZIP",
                  "MAILING_ZIP",
                  "OwnerZip",
                  "mail_zip",
                  "OWN_ZIPCD",
                ]),
              ) ??
              extractZip(
                pickAttr(a, [
                  "TAX_ADDRESS",
                  "MAIL_ADDRESS",
                  "MAILING_ADDRESS",
                  "ADDRESS1",
                  "ADDRESS2",
                  "mail_addr_street",
                  "OwnerAddr2",
                  "OWN_ADDR2",
                ]),
              );
            const propType = (
              pickAttr(a, [
                "D_CLASS_CN",
                "PROPERTY_TYPE",
                "LAND_USE",
                "ASSET_TYPE",
                "USE_CODE",
                "ACCOUNTTYP",
                "ACCTTYPE",
                "tax_luc_description",
                "ext_luc_description",
                "property_class",
                "zoning_use",
                "LUCode",
                "DOR_UC",
              ]) ?? ""
            ).toLowerCase();
            const inspDays = daysSince(
              pickAttr(a, ["LAST_INSPECTION_DATE", "LastInspection", "PERMIT_LAST_INSPECTION"]),
            );
            const price =
              toNum(
                pickAttr(a, [
                  "TOTAL_VALU",
                  "MARKET_VALUE",
                  "ASSESSED_VALUE",
                  "APPRAISED_VALUE",
                  "TOTALASD",
                  "TOTALACT",
                  "sales_amount",
                  "certified_tax_total",
                  "gross_certified_total",
                  "TotAppr",
                  "TotAssess",
                  "JV",
                  "SALE_PRC1",
                ]),
              ) ?? 5000;
            const externalId = pickAttr(a, [
              "PIN",
              "PARCEL_ID",
              "PARCELID",
              "PARCEL",
              "ACCOUNTNO",
              "SCHEDNUM",
              "parcelpin",
              "PARCELNO",
              "ParcelID",
              "OBJECTID",
              "FID",
            ]);
            const stateCode = (
              pickAttr(a, ["SITUS_STAT", "STATE", "OWN_STATE"]) ??
              HOST_STATE[new URL(gisUrl).hostname] ??
              "OH"
            )
              .slice(0, 2)
              .toUpperCase();
            // --- Qualified Intermediary (QI) deed filter -------------------
            const grantor = pickAttr(a, [
              "GRANTOR",
              "SELLER",
              "PREV_OWNER",
              "PRIOR_OWNER",
              "DEED_GRANTOR",
            ]);
            const grantee = pickAttr(a, ["GRANTEE", "BUYER", "DEED_GRANTEE"]);
            const qi = detectQualifiedIntermediary(grantor, grantee, owner);
            const xfer = pickAttr(a, [
              "TRANSFER_DATE",
              "SALE_DATE",
              "LastSaleDate",
              "transfer_date",
            ]);
            const win = qi.is1031 ? exchangeWindow(xfer) : null;

            // --- Acreage + USDA FIA timber overlay -------------------------
            const acreage =
              toNum(
                pickAttr(a, [
                  "ACRES",
                  "ACREAGE",
                  "GIS_ACRES",
                  "DEED_ACRES",
                  "LAND_ACRES",
                  "CALC_ACRES",
                  "Shape__Acres",
                ]),
              ) ??
              (toNum(pickAttr(a, ["LOT_SQFT", "LAND_SQFT", "Shape__Area"])) != null
                ? Number(toNum(pickAttr(a, ["LOT_SQFT", "LAND_SQFT", "Shape__Area"]))) / 43560
                : null);
            let timber = {
              acreage,
              timber_density_score: null as number | null,
              estimated_stumpage_mbf: null as number | null,
              like_kind_eligible: false,
            };
            try {
              const { timberOverlay } = await import("@/lib/timber.server");
              timber = await timberOverlay({
                acreage,
                landUse: propType,
                lon: toNum(pickAttr(a, ["LON", "LONGITUDE", "X", "CENTROID_X"])),
                lat: toNum(pickAttr(a, ["LAT", "LATITUDE", "Y", "CENTROID_Y"])),
              });
            } catch (e) {
              console.error("[gis] timber overlay failed", (e as Error).message);
            }

            // Heuristics
            const tags: string[] = [];
            const isLLC = /\b(LLC|L\.L\.C\.|LP|L\.P\.)\b/i.test(owner);
            if (isLLC && (ownerTransfers.get(owner) ?? 0) >= 1) {
              tags.push("LLC-LIQUIDATION-SIGNAL");
            }
            const isCommercialOrMulti =
              /commercial|multi|apartment|pad|industrial|retail/i.test(propType);
            if (isCommercialOrMulti && inspDays != null && inspDays > 180) {
              tags.push("STALLED-DEVELOPMENT");
            }
            if (propZip && taxZip && propZip !== taxZip) {
              tags.push("1031-PROBABLE");
            }
            if (qi.is1031) tags.push("QI-DEED");
            if (timber.like_kind_eligible) tags.push("TIMBER-LIKE-KIND");

            if (tags.length === 0) continue;
            tagged++;

            if (!propZip) {
              dlq++;
              await supabaseAdmin.from("dead_letter_queue").insert({
                raw_payload: a as any,
                source_ip: "cron",
                error_reason: "gis_missing_zip",
              });
              continue;
            }

            // Map land-use to asset_type for Orange Square matching.
            let assetType = "SFR";
            if (/multi|apartment/i.test(propType)) assetType = "Multi-Family";
            else if (/commercial|pad|retail/i.test(propType)) assetType = "Commercial-Pad";
            else if (/vacant|lot|infill/i.test(propType)) assetType = "Infill-Lot";
            if (timber.like_kind_eligible) assetType = "Timberland";

            const fee = Math.max(Math.round(price * 0.10), 10000);
            const distressNote = tags.join(",");
            const addressWithTag = propAddr
              ? `${propAddr} [${distressNote}]`
              : `[${distressNote}]`;

            // Qualified deals bypass Scout and land straight in dispatch.
            const conf = calculateLeadConfidence({
              address: addressWithTag,
              zip: propZip,
              base_contract_price: price,
            });
            const fastLane = conf.passed && (qi.is1031 || timber.like_kind_eligible);

            const onConflict = externalId ? "external_id" : "zip,address";
            const { error: insErr, data: ins } = await supabaseAdmin
              .from("closing_pipeline_items")
              .upsert(
                {
                  external_id: externalId ? `gis:${externalId}` : null,
                  address: addressWithTag,
                  zip: propZip,
                  state: stateCode,
                  county: pickAttr(a, ["COUNTY", "TAX_DIST", "SITUS_CITY"]) ?? "Unknown",
                  base_contract_price: price,
                  optimized_acquisition_premium: fee,
                  asset_type: assetType,
                  status: fastLane ? "Webhook_Dispatched" : "New",
                  confidence_score: conf.score,
                  notification_queued: fastLane,
                  source: "gis_distress",
                  is_equitable_interest: true,
                  qi_entity: qi.qiEntity,
                  is_1031_candidate: qi.is1031,
                  exchange_identified_at: win?.identifiedAt ?? null,
                  exchange_deadline_at: win?.deadlineAt ?? null,
                  acreage: timber.acreage,
                  timber_density_score: timber.timber_density_score,
                  estimated_stumpage_mbf: timber.estimated_stumpage_mbf,
                  like_kind_eligible: timber.like_kind_eligible || qi.is1031,
                } as never,
                { onConflict, ignoreDuplicates: true },
              )
              .select("id");


            if (insErr) {
              dlq++;
              await supabaseAdmin.from("dead_letter_queue").insert({
                raw_payload: { tags, attrs: a } as any,
                source_ip: "cron",
                error_reason: `gis_insert_failed: ${insErr.message}`,
              });
            } else if (!ins || ins.length === 0) {
              deduped++;
            } else {
              inserted++;
            }
          } catch (e) {
            dlq++;
            try {
              await supabaseAdmin.from("dead_letter_queue").insert({
                raw_payload: f.attributes as any,
                source_ip: "cron",
                error_reason: `gis_row_exception: ${(e as Error).message}`,
              });
            } catch {}
          }
        }

        perSource.push({ url: gisUrl, features: features.length });
        totalFeatures += features.length;
        } // end source loop

        await supabaseAdmin.from("ingest_runs").insert({
          source: "arcgis_gis",
          status: "ok",
          total_rows: totalFeatures,
          inserted,
          deduped,
          dlq,
        });

        return Response.json({
          ok: true,
          sources: perSource,
          total_features: totalFeatures,
          tagged,
          inserted,
          deduped,
          dlq,
          ran_at: new Date().toISOString(),
        });
      },
    },
  },
});
