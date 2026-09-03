// DLQ ZIP Derivation & Recovery.
// Salvages parcels rejected with `gis_missing_zip` by deriving the postal code
// from the payload itself (explicit zip fields, address string, owner mailing
// address) and only then falling back to a free geocode. Bounded batch,
// single-flight lock, idempotent: a recovered row is deleted from the DLQ in
// the same step it is inserted into the pipeline. Fail-forward throughout.
import { createFileRoute } from "@tanstack/react-router";

const LOCK_KEY = "dlq_zip_recovery_lock";
const LOCK_MS = 5 * 60 * 1000;
const MAX_BATCH = 100;

function norm(k: string) {
  return k.toLowerCase().replace(/[\s\-._]/g, "");
}

function pick(raw: Record<string, unknown>, names: string[]): string | null {
  for (const [k, v] of Object.entries(raw)) {
    if (v == null || v === "") continue;
    if (names.includes(norm(k))) return String(v).trim();
  }
  return null;
}

const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/;
const ZIP9_RE = /\b(\d{5})(\d{4})\b/;

/** 5-digit ZIP from a string, tolerating unpadded ZIP+4 ("800052024"). */
function zip5(s: string | null | undefined): string | null {
  if (!s) return null;
  const nine = s.match(ZIP9_RE);
  if (nine) return nine[1]!;
  const m = s.match(ZIP_RE);
  return m ? m[1]! : null;
}

/** Derive a 5-digit ZIP from the raw parcel payload. Order = confidence. */
function deriveZip(raw: Record<string, unknown>): { zip: string; via: string } | null {
  const direct = zip5(
    pick(raw, [
      "zip", "zipcode", "zip5", "postal", "postalcode", "situszip", "propzip", "sitezip",
    ]),
  );
  if (direct) return { zip: direct, via: "field" };

  const addr = zip5(pick(raw, ["address", "situsaddress", "propaddr", "fulladdress", "siteaddr"]));
  if (addr) return { zip: addr, via: "address" };

  // Owner mailing address ("ATLANTA GA 30315") — absentee owners are the
  // signal, so this is a last-resort locality hint, flagged as such.
  for (const key of ["owneraddr2", "owneraddress2", "mailaddr2", "owneraddr", "mailingaddress"]) {
    const v = zip5(pick(raw, [key]));
    if (v) return { zip: v, via: "owner_mail" };
  }
  return null;
}

/** Free reverse geocode (Census, no key) from parcel centroid coordinates. */
async function zipFromCoords(raw: Record<string, unknown>): Promise<string | null> {
  const lat = Number(pick(raw, ["lat", "latitude", "y", "centroidy"]));
  const lon = Number(pick(raw, ["lon", "long", "longitude", "x", "centroidx"]));
  if (!isFinite(lat) || !isFinite(lon) || lat === 0 || lon === 0) return null;
  try {
    const url =
      "https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=" +
      encodeURIComponent(String(lon)) +
      "&y=" + encodeURIComponent(String(lat)) +
      "&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json";
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const j: any = await res.json();
    const geos = j?.result?.geographies ?? {};
    for (const key of Object.keys(geos)) {
      if (!/zip/i.test(key)) continue;
      const z = geos[key]?.[0]?.["ZCTA5"] ?? geos[key]?.[0]?.["BASENAME"];
      if (z && /^\d{5}$/.test(String(z))) return String(z);
    }
    return null;
  } catch {
    return null;
  }
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  return isFinite(n) && n > 0 ? n : null;
}

export const Route = createFileRoute("/api/public/hooks/dlq-zip-recovery")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: "POST to run the DLQ ZIP recovery batch" }),
      POST: async ({ request }) => {
        const started = Date.now();
        let scanned = 0, recovered = 0, geocoded = 0, unresolved = 0;
        try {
          const body = (await request.json().catch(() => ({}))) as { limit?: number };
          const limit = Math.min(MAX_BATCH, Math.max(1, Number(body?.limit) || 50));
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // --- single-flight lease -------------------------------------
          try {
            const { data: flag } = await supabaseAdmin
              .from("system_flags")
              .select("key, bool_value, updated_at")
              .eq("key", LOCK_KEY)
              .maybeSingle();
            const heldAt = (flag as any)?.updated_at ? new Date((flag as any).updated_at).getTime() : 0;
            if ((flag as any)?.bool_value === true && Date.now() - heldAt < LOCK_MS) {
              return Response.json({ ok: true, skipped: "locked" });
            }
            await supabaseAdmin
              .from("system_flags")
              .upsert(
                { key: LOCK_KEY, bool_value: true, updated_at: new Date().toISOString() } as never,
                { onConflict: "key" },
              );
          } catch {
            /* lock table optional — never stall the recovery */
          }

          const { data: items } = await supabaseAdmin
            .from("dead_letter_queue")
            .select("*")
            .eq("error_reason", "gis_missing_zip")
            .lt("retry_count", 3)
            .order("created_at", { ascending: true })
            .limit(limit);

          for (const item of (items ?? []) as Record<string, any>[]) {
            scanned++;
            try {
              const raw = (item['raw_payload'] ?? {}) as Record<string, unknown>;
              let hit = deriveZip(raw);
              if (!hit) {
                // Throttle the only external call so Census never 429s the batch.
                await new Promise((r) => setTimeout(r, 200));
                const z = await zipFromCoords(raw);
                if (z) {
                  hit = { zip: z, via: "geocode" };
                  geocoded++;
                }
              }
              if (!hit) {
                unresolved++;
                await supabaseAdmin
                  .from("dead_letter_queue")
                  .update({ retry_count: (item['retry_count'] ?? 0) + 1 } as never)
                  .eq("id", item['id']);
                continue;
              }

              const address = pick(raw, ["address", "situsaddress", "propaddr", "fulladdress", "siteaddr"]);
              const owner = pick(raw, ["owner", "ownername", "owner1", "taxpayer"]);
              const apn = pick(raw, ["parcelid", "apn", "parcelnumber", "pin", "parcel"]);
              const acreage = toNum(pick(raw, ["landacres", "acres", "acreage", "landacresdeed"]));
              const appraised =
                toNum(pick(raw, ["totappr", "totalvalue", "marketvalue", "apprtot"])) ??
                toNum(pick(raw, ["landappr", "assessedvalue", "totassess"]));
              // Unappraised public parcels still enter the pipeline; the
              // underwriter derives ARV from ACS. Never drop for missing price.
              // Placeholder of 1 satisfies NOT NULL; the underwriter overwrites
              // it once ARV is derived. Never drop a lead over a missing price.
              const price = appraised ? Math.round(appraised * 0.6) : 1;

              const { error: insErr } = await supabaseAdmin
                .from("closing_pipeline_items")
                .upsert(
                  {
                    external_id: apn ? `dlq:${apn}` : null,
                    address: address ?? null,
                    zip: hit.zip,
                    apn: apn ?? null,
                    owner_entity: owner ?? null,
                    acreage: acreage ?? null,
                    assessed_value: appraised ?? null,
                    base_contract_price: price,
                    status: "Pending-Underwriting" as const,
                    source: "dlq_zip_recovery",
                    enrichment_tags: [`ZIP_VIA_${hit.via.toUpperCase()}`],
                  } as never,
                  { onConflict: apn ? "external_id" : "zip,address", ignoreDuplicates: false },
                );
              if (insErr) throw insErr;

              await supabaseAdmin.from("dead_letter_queue").delete().eq("id", item['id']);
              recovered++;
            } catch (e) {
              console.error("[dlq-zip] row failed", item['id'], (e as Error).message);
              await supabaseAdmin
                .from("dead_letter_queue")
                .update({ retry_count: (item['retry_count'] ?? 0) + 1 } as never)
                .eq("id", item['id']);
            }
          }

          try {
            await supabaseAdmin.from("ingest_runs").insert({
              source: "dlq-zip-recovery",
              status: "ok",
              total_rows: scanned,
              inserted: recovered,
              dlq: unresolved,
              note: `${geocoded} geocoded in ${Date.now() - started}ms`,
            } as never);
          } catch {
            /* fail-forward */
          }

          try {
            await supabaseAdmin
              .from("system_flags")
              .upsert(
                { key: LOCK_KEY, bool_value: false, updated_at: new Date().toISOString() } as never,
                { onConflict: "key" },
              );
          } catch {
            /* lease expires on its own */
          }

          return Response.json({
            ok: true, scanned, recovered, geocoded, unresolved, ms: Date.now() - started,
          });
        } catch (e) {
          console.error("[dlq-zip] unhandled", e);
          return Response.json(
            { ok: false, error: (e as Error).message, scanned, recovered },
            { status: 200 },
          );
        }
      },
    },
  },
});
