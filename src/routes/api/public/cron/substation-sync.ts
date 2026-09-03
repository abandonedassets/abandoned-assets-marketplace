// Substation location sync worker. Fetches a JSON/GeoJSON list of substations
// from the HIFLD endpoint and upserts valid coordinates into retail_locations.
// Fail-forward: one bad record never stalls the batch.
import { createFileRoute } from "@tanstack/react-router";

type RawSubstation = Record<string, unknown>;

const HIFLD_SUBSTATIONS_URL =
  "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Substations_1/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson";

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return isFinite(n) ? n : null;
};

const str = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

export const Route = createFileRoute("/api/public/cron/substation-sync")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, hint: "POST with x-cron-secret to run the sync" }),
      POST: async ({ request }) => {
        const started = Date.now();
        let fetched = 0;
        let upserted = 0;
        let skipped = 0;
        try {
          const secret = process.env["CRON_SECRET"];
          if (secret && request.headers.get("x-cron-secret") !== secret) {
            return new Response("Unauthorized", { status: 401 });
          }

          const body = (await request.json().catch(() => ({}))) as {
            feed_url?: string;
            limit?: number;
          };
          const feedUrl =
            (typeof body.feed_url === "string" && body.feed_url) ||
            process.env["SUBSTATION_FEED_URL"] ||
            HIFLD_SUBSTATIONS_URL;
          if (!/^https:\/\//i.test(feedUrl)) {
            return Response.json(
              { ok: false, error: "missing_or_insecure_feed_url" },
              { status: 200 },
            );
          }
          const limit = Math.min(Math.max(Number(body.limit) || 500, 1), 2000);

          const res = await fetch(feedUrl, { signal: AbortSignal.timeout(30_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json: unknown = await res.json();
          const list: RawSubstation[] = Array.isArray(json)
            ? (json as RawSubstation[])
            : Array.isArray((json as { features?: unknown })?.features)
              ? (json as { features: RawSubstation[] }).features.map((f) => {
                  const props = (f?.["properties"] ?? f?.["attributes"] ?? {}) as RawSubstation;
                  const coords = ((f?.["geometry"] as { coordinates?: unknown })?.coordinates ??
                    []) as unknown[];
                  return {
                    ...props,
                    lon: props["lon"] ?? props["LONGITUDE"] ?? coords[0],
                    lat: props["lat"] ?? props["LATITUDE"] ?? coords[1],
                  } as RawSubstation;
                })
              : Array.isArray((json as { data?: unknown })?.data)
                ? (json as { data: RawSubstation[] }).data
                : [];
          fetched = list.length;

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          for (const raw of list.slice(0, limit)) {
            try {
              const lon = num(raw["lon"] ?? raw["longitude"] ?? raw["lng"]);
              const lat = num(raw["lat"] ?? raw["latitude"]);
              const name = str(raw["name"] ?? raw["NAME"] ?? raw["substation_name"] ?? raw["title"]);
              if (
                lon == null ||
                lat == null ||
                lon < -180 ||
                lon > 180 ||
                lat < -90 ||
                lat > 90 ||
                !name
              ) {
                skipped++;
                continue;
              }

              const externalId = str(raw["id"] ?? raw["ID"] ?? raw["OBJECTID"] ?? raw["external_id"] ?? raw["code"]);
              const { error } = await supabaseAdmin
                .from("retail_locations" as never)
                .upsert(
                  {
                    external_id: externalId ? `substation:${externalId}` : null,
                    name,
                    kind: "substation",
                    address: str(raw["address"] ?? raw["ADDRESS"]),
                    city: str(raw["city"] ?? raw["CITY"]),
                    state: str(raw["state"] ?? raw["STATE"]),
                    zip: str(raw["zip"] ?? raw["ZIP"] ?? raw["postal_code"]),
                    geom: `SRID=4326;POINT(${lon} ${lat})`,
                    source: "hifld_substations",
                    is_active: true,
                  } as never,
                  { onConflict: "external_id" },
                );
              if (error) {
                skipped++;
                console.error("[substation-sync] upsert failed", error.message);
              } else {
                upserted++;
              }
            } catch (e) {
              skipped++;
              console.error("[substation-sync] row failed", (e as Error).message);
            }
          }

          return Response.json({
            ok: true,
            fetched,
            upserted,
            skipped,
            ms: Date.now() - started,
          });
        } catch (e) {
          console.error("[substation-sync] unhandled", e);
          return Response.json(
            { ok: false, error: (e as Error).message, fetched, upserted, skipped },
            { status: 200 },
          );
        }
      },
    },
  },
});
