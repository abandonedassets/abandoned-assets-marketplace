// 24/7 vendor relay. External lead vendors POST raw property payloads here in
// any shape; fields are aliased, deduped by hash, inserted, and underwritten.
// Optional shared secret via VENDOR_RELAY_SECRET (?secret= or x-vendor-secret).
import { createFileRoute } from "@tanstack/react-router";

function pick(o: Record<string, any>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k] ?? o[k.toLowerCase()] ?? o[k.toUpperCase()];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  return isFinite(n) && n > 0 ? n : null;
}

export const Route = createFileRoute("/api/public/vendor/relay")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          accepts: "POST { deals: [ { address, city, state, zip, price, arv?, repairs?, sqft?, beds?, baths?, year_built?, asset_type? } ] }",
        }),
      POST: async ({ request }) => {
        try {
          const secret = process.env['VENDOR_RELAY_SECRET'];
          if (secret) {
            const url = new URL(request.url);
            const given =
              request.headers.get("x-vendor-secret") ?? url.searchParams.get("secret") ?? "";
            if (given !== secret)
              return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
          }

          const raw = (await request.json().catch(() => ({}))) as any;
          const list: any[] = Array.isArray(raw)
            ? raw
            : Array.isArray(raw?.deals)
              ? raw.deals
              : raw && typeof raw === "object"
                ? [raw]
                : [];
          if (!list.length)
            return Response.json({ ok: false, error: "empty_payload" }, { status: 400 });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const source = pick(raw ?? {}, ["source", "vendor"]) ?? "vendor_relay";

          let inserted = 0;
          let deduped = 0;
          let dlq = 0;

          for (const d of list.slice(0, 500)) {
            try {
              const address = pick(d, ["address", "street", "property_address", "addr"]);
              const zip = (pick(d, ["zip", "zipcode", "postal_code", "postcode"]) ?? "").slice(0, 5);
              const price = num(d.price ?? d.offer_price ?? d.asking_price ?? d.base_contract_price);
              if (!zip || !/^\d{5}$/.test(zip) || !price) {
                dlq++;
                await supabaseAdmin.from("dead_letter_queue").insert({
                  raw_payload: d as any,
                  source_ip: source,
                  error_reason: "missing_zip_or_price",
                } as never);
                continue;
              }

              const key = `${source}:${address ?? ""}:${zip}:${price}`;
              const hashBuf = await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(key),
              );
              const hash = Array.from(new Uint8Array(hashBuf))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");

              const { error: dupErr } = await supabaseAdmin
                .from("ingest_idempotency_keys")
                .insert({ hash, source } as never);
              if (dupErr) {
                deduped++;
                continue;
              }

              const { error: insErr } = await supabaseAdmin
                .from("closing_pipeline_items")
                .insert({
                  zip,
                  address,
                  city: pick(d, ["city", "municipality"]),
                  state: pick(d, ["state", "st"]),
                  county: pick(d, ["county"]),
                  apn: pick(d, ["apn", "parcel_id", "parcel"]),
                  base_contract_price: price,
                  assessed_value: num(d.arv ?? d.assessed_value ?? d.market_value),
                  estimated_repairs: num(d.repairs ?? d.estimated_repairs) ?? 0,
                  sqft: num(d.sqft ?? d.living_area),
                  beds: num(d.beds ?? d.bedrooms),
                  baths: num(d.baths ?? d.bathrooms),
                  year_built: num(d.year_built ?? d.yearbuilt),
                  acreage: num(d.acreage ?? d.lot_acres),
                  asset_type: pick(d, ["asset_type", "property_type"]) ?? "SFR",
                  source,
                  idempotency_key: hash,
                } as never);

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
            } catch (e) {
              dlq++;
              console.error("[vendor-relay] row failed", (e as Error).message);
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

          // Zero-touch: underwrite the freshly landed rows immediately.
          const origin = new URL(request.url).origin;
          fetch(`${origin}/api/public/cron/auto-underwrite`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ limit: Math.max(10, inserted) }),
          }).catch(() => {});

          return Response.json({ ok: true, inserted, deduped, dlq });
        } catch (e) {
          console.error("[vendor-relay] unhandled", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
        }
      },
    },
  },
});
