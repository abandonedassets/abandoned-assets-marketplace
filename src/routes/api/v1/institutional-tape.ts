import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";

const ACTIVE_STATUSES = [
  "New",
  "Under-Review",
  "Seller-Signed",
  "Buyer-Signed",
  "In-Escrow",
] as const;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const PRICE_INTEGRITY_REJECTION = {
  error: "fixed_terms",
  message:
    "Asset terms are fixed for optimal buyer ROI. Please accept standard payload to proceed.",
};

const rejectCounterOffer = () =>
  Response.json(PRICE_INTEGRITY_REJECTION, {
    status: 400,
    headers: { ...CORS_HEADERS, Allow: "GET, OPTIONS" },
  });

const ENDPOINT = "/api/v1/institutional-tape";

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function logRequest(
  admin: any,
  apiKeyId: string | null,
  status: number,
) {
  try {
    await admin.from("institutional_api_request_log").insert({
      api_key_id: apiKeyId,
      endpoint: ENDPOINT,
      http_status: status,
    });
  } catch (e) {
    console.error("api_request_log insert failed", e);
  }
}

export const Route = createFileRoute("/api/v1/institutional-tape")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async () => rejectCounterOffer(),
      PUT: async () => rejectCounterOffer(),
      PATCH: async () => rejectCounterOffer(),
      DELETE: async () => rejectCounterOffer(),
      GET: async ({ request }) => {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const headerAuth = request.headers.get("authorization") ?? "";
        const bearer = headerAuth.toLowerCase().startsWith("bearer ")
          ? headerAuth.slice(7).trim()
          : "";

        const DARK_POOL_RESTRICTED = {
          status: "restricted",
          message:
            "Institutional Allocation Full. Your fund's API key is currently in the waitlist queue. Please contact the desk to request allocation.",
          request_allocation_endpoint: "/api/public/request-key",
        };

        if (!bearer) {
          await logRequest(supabaseAdmin, null, 403);
          return Response.json(DARK_POOL_RESTRICTED, {
            status: 403,
            headers: CORS_HEADERS,
          });
        }

        const { data: keyRow, error: keyErr } = await supabaseAdmin
          .from("institutional_api_keys")
          .select("id, is_active, rate_limit_per_minute, label")
          .eq("key_hash", hashKey(bearer))
          .maybeSingle();

        if (keyErr || !keyRow || !keyRow.is_active) {
          await logRequest(supabaseAdmin, keyRow?.id ?? null, 403);
          return Response.json(DARK_POOL_RESTRICTED, {
            status: 403,
            headers: CORS_HEADERS,
          });
        }

        // Rate limit: count requests in last 60s for this key
        const windowStart = new Date(Date.now() - 60_000).toISOString();
        const { count: recentCount } = await supabaseAdmin
          .from("institutional_api_request_log")
          .select("id", { count: "exact", head: true })
          .eq("api_key_id", keyRow.id)
          .gte("requested_at", windowStart);

        const limit = keyRow.rate_limit_per_minute ?? 60;
        if ((recentCount ?? 0) >= limit) {
          await logRequest(supabaseAdmin, keyRow.id, 429);
          return Response.json(
            {
              error: "rate_limit_exceeded",
              limit_per_minute: limit,
              retry_after_seconds: 60,
            },
            {
              status: 429,
              headers: {
                ...CORS_HEADERS,
                "Retry-After": "60",
                "X-RateLimit-Limit": String(limit),
                "X-RateLimit-Remaining": "0",
              },
            },
          );
        }

        let rows: Array<{
          id: string;
          zip: string;
          beds: number | null;
          baths: number | null;
          sqft: number | null;
          year_built: number | null;
          base_contract_price: string | number;
          optimized_acquisition_premium: string | number | null;
          status: string;
          updated_at: string;
        }>;

        try {
          const { data, error } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select(
              "id, zip, beds, baths, sqft, year_built, base_contract_price, optimized_acquisition_premium, status, updated_at",
            )
            .in("status", [...ACTIVE_STATUSES]);
          if (error) throw error;
          rows = (data ?? []) as typeof rows;
        } catch (e) {
          console.error("institutional-tape db error", e);
          await logRequest(supabaseAdmin, keyRow.id, 503);
          return Response.json(
            { error: "upstream_unavailable" },
            { status: 503, headers: CORS_HEADERS },
          );
        }

        const generatedAt = new Date().toISOString();
        const now = Date.now();

        let totalFee = 0;
        const tape = rows.map((r) => {
          const base = Number(r.base_contract_price) || 0;
          const fee = Number(r.optimized_acquisition_premium) || 0;
          const total = base + fee;
          totalFee += fee;
          const hoursOnMarket = Math.floor(
            (now - new Date(r.updated_at).getTime()) / 3_600_000,
          );
          return {
            tranche_id: r.id,
            target_zip: r.zip,
            property_profile: {
              beds: r.beds,
              baths: r.baths !== null ? Number(r.baths) : null,
              sqft: r.sqft,
              year_built: r.year_built,
            },
            base_contract_price: Math.round(base * 100) / 100,
            explicit_assignment_fee: Math.round(fee * 100) / 100,
            total_acquisition_cost: Math.round(total * 100) / 100,
            underwritten_arv: Math.round(total * 100) / 100,
            arv_methodology:
              "base_contract_price + explicit_assignment_fee (internal underwriting model; not a licensed appraisal)",
            status: r.status,
            hours_since_last_update: hoursOnMarket,
            priority_flag: hoursOnMarket >= 24 ? "aging_inventory" : "standard",
          };
        });

        // Touch last_used_at + log success
        try {
          await supabaseAdmin
            .from("institutional_api_keys")
            .update({ last_used_at: new Date().toISOString() })
            .eq("id", keyRow.id);
        } catch {}
        await logRequest(supabaseAdmin, keyRow.id, 200);

        const body = {
          header: {
            generated_at: generatedAt,
            api_key_label: keyRow.label,
            rate_limit_per_minute: limit,
            rate_limit_remaining: Math.max(0, limit - ((recentCount ?? 0) + 1)),
            total_assignment_fee_disclosed: Math.round(totalFee * 100) / 100,
            tranche_count: tape.length,
            disclosure:
              "All assignment fees are explicitly disclosed. ARV is an internal underwriting estimate, not a licensed appraisal.",
          },
          tape,
        };

        return new Response(JSON.stringify(body), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "Cache-Control": "private, no-store",
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": String(
              Math.max(0, limit - ((recentCount ?? 0) + 1)),
            ),
          },
        });
      },
    },
  },
});
