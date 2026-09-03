import { createFileRoute } from "@tanstack/react-router";

/**
 * Cognitive Ingestion Engine — "Catch-All Webhook"
 *
 * Accepts any JSON payload from external CRMs, webforms, or title companies.
 * Uses lightweight field-intent mapping to normalize messy data into
 * closing_pipeline_items. Auto-computes assignment fee before insert.
 *
 * If payload is completely unmappable, routes to dead_letter_queue
 * for autonomous retry.
 */

// --- Field-Intent Mapping ---
// Each key in the map is a canonical DB column.
// The array values are common aliases an external system might use.
const FIELD_MAP: Record<string, string[]> = {
  zip: ["zip", "zipcode", "zip_code", "postal", "postal_code", "postalcode"],
  beds: ["beds", "bedrooms", "bed_count", "num_beds", "br"],
  baths: ["baths", "bathrooms", "bath_count", "num_baths", "ba"],
  sqft: ["sqft", "sq_ft", "square_feet", "squarefeet", "square_footage", "size", "area"],
  year_built: ["year_built", "yearbuilt", "built_year", "year", "yr_built"],
  base_contract_price: [
    "base_contract_price", "contract_price", "purchase_price", "price",
    "base_amt", "amount", "offer_price", "offer_amount", "asking_price",
    "acquisition_price", "buy_price",
  ],
  underwritten_arv: [
    "underwritten_arv", "arv", "after_repair_value", "after_repair",
    "target_arv", "est_value", "estimated_value", "market_value",
    "rehab_value", "fmv", "fair_market_value",
  ],
  status: ["status", "deal_status", "stage", "pipeline_stage", "state"],
};

// Lowercase-normalize a key for fuzzy matching
function normalize(key: string): string {
  return key.toLowerCase().replace(/[\s\-\.]/g, "_");
}

// Map an arbitrary payload to canonical fields
function mapPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  const normalizedEntries = Object.entries(raw).map(
    ([k, v]) => [normalize(k), v] as const
  );

  for (const [canonical, aliases] of Object.entries(FIELD_MAP)) {
    for (const alias of aliases) {
      const found = normalizedEntries.find(([k]) => k === alias);
      if (found && found[1] != null && found[1] !== "") {
        mapped[canonical] = found[1];
        break;
      }
    }
  }
  return mapped;
}

// Parse a numeric value from various formats
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  return isFinite(n) ? n : null;
}

// Tiered assignment-fee model. Scales with property value so large-cap deals
// never silently flatten to $5k. Floor $5k, cap $500k. Mirrors county-ingest.
function computeFee(basePrice: number, arv: number | null): number {
  const FLOOR = 5000;
  const CAP = 500_000;
  const price = isFinite(basePrice) && basePrice > 0 ? basePrice : 0;
  let pct: number;
  if (price < 100_000) pct = 0.05;
  else if (price < 500_000) pct = 0.04;
  else if (price < 2_000_000) pct = 0.03;
  else pct = 0.025;
  const tiered = Math.round(price * pct);
  const spread = arv && arv > price ? Math.round((arv - price) * 0.10) : 0;
  return Math.min(Math.max(FLOOR, tiered, spread), CAP);
}

const VALID_STATUSES = ["New", "Under-Review", "Seller-Signed", "Buyer-Signed", "In-Escrow"];

export const Route = createFileRoute("/api/public/hooks/cognitive-ingest")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        }),

      POST: async ({ request }) => {
        const CORS = {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        };

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        let rawBody: string;
        let rawPayload: Record<string, unknown>;

        try {
          rawBody = await request.text();
          rawPayload = JSON.parse(rawBody);
          if (typeof rawPayload !== "object" || rawPayload === null || Array.isArray(rawPayload)) {
            throw new Error("Payload must be a JSON object");
          }
        } catch (e) {
          // Completely unparseable — straight to DLQ
          try {
            await supabaseAdmin.from("dead_letter_queue").insert({
              raw_payload: { _raw: rawBody! ?? "unparseable" },
              source_ip: request.headers.get("x-forwarded-for") ?? "unknown",
              error_reason: `Parse error: ${(e as Error).message}`,
            });
          } catch {}
          return Response.json(
            { ingested: false, reason: "invalid_json", routed: "dead_letter_queue" },
            { status: 400, headers: CORS }
          );
        }

        // Map fields
        const mapped = mapPayload(rawPayload);

        // Validate minimum required: must have a price or identifiable property data
        const basePrice = toNum(mapped.base_contract_price);
        const zip = mapped.zip ? String(mapped.zip).trim() : null;

        if (!basePrice || basePrice <= 0) {
          // Can't price it — DLQ
          try {
            await supabaseAdmin.from("dead_letter_queue").insert({
              raw_payload: rawPayload as any,
              source_ip: request.headers.get("x-forwarded-for") ?? "unknown",
              error_reason: "No identifiable price field in payload",
            });
          } catch {}
          return Response.json(
            { ingested: false, reason: "no_price_field", routed: "dead_letter_queue" },
            { status: 422, headers: CORS }
          );
        }

        // Compute fee
        const arv = toNum(mapped.underwritten_arv);
        const fee = computeFee(basePrice, arv);

        // Normalize status
        let status = "New";
        if (mapped.status) {
          const rawStatus = String(mapped.status).trim();
          const match = VALID_STATUSES.find(
            (s) => s.toLowerCase() === rawStatus.toLowerCase()
          );
          if (match) status = match;
        }

        // Insert into pipeline
        const rawZoning =
          (rawPayload["zoning"] ?? rawPayload["zoning_class"] ?? rawPayload["zoning_code"] ?? rawPayload["land_use"]) as
            | string
            | undefined;
        const rawAssetType = (rawPayload["asset_type"] ?? rawPayload["property_type"]) as string | undefined;
        const msaMiles = toNum(
          rawPayload["msa_distance_miles"] ?? rawPayload["miles_to_msa"] ?? rawPayload["distance_to_msa"],
        );

        const row = {
          ...(rawZoning ? { zoning_class: String(rawZoning) } : {}),
          ...(rawAssetType ? { asset_type: String(rawAssetType) } : {}),
          ...(msaMiles != null ? { msa_distance_miles: msaMiles } : {}),
          zip: zip || "00000",
          beds: toNum(mapped.beds),
          baths: toNum(mapped.baths),
          sqft: toNum(mapped.sqft),
          year_built: toNum(mapped.year_built),
          base_contract_price: basePrice,
          optimized_acquisition_premium: fee,
          status: status as "New" | "Under-Review" | "Seller-Signed" | "Buyer-Signed" | "In-Escrow",
        };

        const { data, error } = await supabaseAdmin
          .from("closing_pipeline_items")
          .insert(row)
          .select("id")
          .single();

        if (error) {
          // DB insert failed — DLQ
          try {
            await supabaseAdmin.from("dead_letter_queue").insert({
              raw_payload: rawPayload as any,
              source_ip: request.headers.get("x-forwarded-for") ?? "unknown",
              error_reason: `DB insert failed: ${error.message}`,
            });
          } catch {}
          return Response.json(
            { ingested: false, reason: "db_error", routed: "dead_letter_queue" },
            { status: 200, headers: CORS } // fail-forward
          );
        }

        // Shadow Liquidity Router — pre-allocated capital gets first refusal
        // before the asset ever hits the public deal tape.
        let shadow_match = null as unknown;
        try {
          const { routeShadowLiquidity } = await import("@/lib/shadow-liquidity.server");
          shadow_match = await routeShadowLiquidity({
            id: data.id,
            zip: row.zip,
            asset_type: (row as any).asset_type ?? null,
            base_contract_price: basePrice,
            optimized_acquisition_premium: fee,
          });
        } catch (e) {
          console.error("[ingest] shadow routing failed", e);
        }

        return Response.json(
          {
            ingested: true,
            deal_id: data.id,
            shadow_match,
            normalized: row,
            fee_computed: fee,
            arv_detected: arv,
          },
          { status: 201, headers: CORS }
        );
      },
    },
  },
});
