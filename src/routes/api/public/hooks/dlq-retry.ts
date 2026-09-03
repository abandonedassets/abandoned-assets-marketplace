import { createFileRoute } from "@tanstack/react-router";

/**
 * Dead Letter Queue Auto-Resolution
 * 
 * Called hourly by pg_cron. Re-attempts to parse and ingest
 * payloads that previously failed cognitive mapping.
 * Items that fail 3 times are silently dropped.
 */

const FIELD_MAP: Record<string, string[]> = {
  zip: ["zip", "zipcode", "zip_code", "postal", "postal_code"],
  base_contract_price: [
    "base_contract_price", "contract_price", "purchase_price", "price",
    "base_amt", "amount", "offer_price", "acquisition_price",
  ],
  underwritten_arv: [
    "underwritten_arv", "arv", "after_repair_value", "target_arv",
    "est_value", "estimated_value", "market_value",
  ],
  beds: ["beds", "bedrooms", "bed_count"],
  baths: ["baths", "bathrooms", "bath_count"],
  sqft: ["sqft", "sq_ft", "square_feet", "size"],
  year_built: ["year_built", "yearbuilt", "built_year"],
};

function normalize(key: string): string {
  return key.toLowerCase().replace(/[\s\-\.]/g, "_");
}

function mapPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  const entries = Object.entries(raw).map(([k, v]) => [normalize(k), v] as const);
  for (const [canonical, aliases] of Object.entries(FIELD_MAP)) {
    for (const alias of aliases) {
      const found = entries.find(([k]) => k === alias);
      if (found && found[1] != null && found[1] !== "") {
        mapped[canonical] = found[1];
        break;
      }
    }
  }
  return mapped;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  return isFinite(n) ? n : null;
}

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

export const Route = createFileRoute("/api/public/hooks/dlq-retry")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Fetch items with retry_count < 3
        const { data: items, error: fetchErr } = await supabaseAdmin
          .from("dead_letter_queue")
          .select("*")
          .lt("retry_count", 3)
          .order("created_at", { ascending: true })
          .limit(50);

        if (fetchErr || !items?.length) {
          return Response.json({ ok: true, processed: 0, rescued: 0, dropped: 0 });
        }

        let rescued = 0;
        let dropped = 0;

        for (const item of items) {
          try {
            const payload = item.raw_payload as Record<string, unknown>;
            if (!payload || typeof payload !== "object") throw new Error("not an object");

            const mapped = mapPayload(payload);
            const basePrice = toNum(mapped.base_contract_price);

            if (!basePrice || basePrice <= 0) throw new Error("no price");

            const arv = toNum(mapped.underwritten_arv);
            const fee = computeFee(basePrice, arv);
            const zip = mapped.zip ? String(mapped.zip).trim() : "00000";

            const { error: insertErr } = await supabaseAdmin
              .from("closing_pipeline_items")
              .insert({
                zip,
                beds: toNum(mapped.beds),
                baths: toNum(mapped.baths),
                sqft: toNum(mapped.sqft),
                year_built: toNum(mapped.year_built),
                base_contract_price: basePrice,
                optimized_acquisition_premium: fee,
                status: "New" as const,
              });

            if (insertErr) throw insertErr;

            // Rescued — delete from DLQ
            await supabaseAdmin.from("dead_letter_queue").delete().eq("id", item.id);
            rescued++;
          } catch {
            const newCount = (item.retry_count ?? 0) + 1;
            if (newCount >= 3) {
              // Silently drop
              await supabaseAdmin.from("dead_letter_queue").delete().eq("id", item.id);
              dropped++;
            } else {
              await supabaseAdmin
                .from("dead_letter_queue")
                .update({ retry_count: newCount })
                .eq("id", item.id);
            }
          }
        }

        return Response.json({
          ok: true,
          processed: items.length,
          rescued,
          dropped,
        });
      },
    },
  },
});
