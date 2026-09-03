// GET /api/v1/spec — public payload dictionary handed to fund engineering teams.
// Documents the /api/v1/deals/stream feed and the outbound webhook webcast so a
// quant desk can wire an intake without a human call.
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const FIELDS: Record<string, string> = {
  deal_id: "uuid — stable primary identifier for the asset",
  address: "string|null — street address of the parcel",
  city: "string|null",
  state: "string|null — 2-letter USPS code",
  zip: "string — 5-digit ZIP",
  county: "string|null",
  apn: "string|null — assessor parcel number",
  asset_type: "string|null — SFR | LAND | TIMBER | COMMERCIAL | MULTIFAMILY",
  arv: "number — after-repair value (USD)",
  estimated_repairs: "number — repair budget (USD)",
  offer_price: "number — contract/offer price to seller (USD)",
  base_contract_price: "number — alias of offer_price on webhook payloads",
  assignment_fee: "number — fee due to assignor at close (USD)",
  total_to_buyer: "number — offer_price + assignment_fee (USD)",
  spread: "number|null — (arv * 0.70) - estimated_repairs - offer_price",
  title_purity_score: "number|null — 0-100 title cleanliness index",
  title_status: "string|null — Insured | Uninsurable | Pending",
  fema_zone_clear: "boolean — false when the parcel sits in a flood hazard zone",
  projected_post_sale_tax: "number — projected reassessed annual property tax (USD)",
  confidence_score: "number|null — 0-100 ingestion confidence",
  estimated_cap_rate: "number|null — (rent*12*0.65) / total_to_buyer",
  matched_fund_ids: "uuid[] — funds whose buy-box this asset passes 100%",
  composite_score: "number 0-100 — multi-signal conviction rank (stream is sorted desc by this)",
  yield_delta: "number — cap rate minus current regime hurdle",
  market_regime: "EXPANSION|NEUTRAL|SQUEEZE — live macro regime driving the hurdle",
  risk_var_95: "number — Monte Carlo 95% Value-at-Risk vs. buyer basis (USD)",
  uw_ci_low: "number — 5th percentile underwriting outcome (USD)",
  uw_ci_high: "number — 95th percentile underwriting outcome (USD)",
  feedback_url: "POST {deal_id, action: pass|reject|loi|bid, reason} with your Bearer key",

  liquidity_bucket: "string — HOT | WARM | COLD",
  contract_state: "string — UNSENT | SENT | SIGNED | EMD_PENDING | EMD_CLEARED",
  verification_status: "string|null — set once a live Bluevine settlement reference exists",
  vdr_url: "string|null — tokenized machine-readable due-diligence dossier",
  buy_link: "string — Bluevine ACH debit for the $1,000 EMD lock",
  marketplace_url: "string — human GUI fallback",
  updated_at: "ISO-8601 timestamp",
};

export const Route = createFileRoute("/api/v1/spec")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return Response.json(
          {
            version: "1.0",
            generated_at: new Date().toISOString(),
            authentication: {
              scheme: "Bearer",
              header: "Authorization: Bearer <FUND_SECRET_TOKEN>",
              issuance: "Keys are minted per fund; contact the desk to provision.",
              rate_limit: "Per-key requests/minute; 429 on breach.",
            },
            channels: {
              pull_stream: {
                url: `${origin}/api/v1/deals/stream`,
                method: "GET",
                auth: "required",
                formats: ["json", "ndjson (?format=ndjson)"],
                query_params: {
                  zip: "filter by 5-digit ZIP",
                  asset_type: "filter by asset class",
                  min_fee: "minimum assignment_fee (USD)",
                  limit: "1-1000, default 250",
                  format: "ndjson for line-delimited streaming ingest",
                },
                polling: "Recommended 5-15s poll, or long-lived NDJSON pull.",
              },
              outbound_webhook: {
                description:
                  "Register an intake URL; every newly dispatched asset is POSTed as JSON.",
                method: "POST",
                content_type: "application/json",
                payload: "Same field dictionary as the pull stream.",
                retry: "Failures are logged and retried by the outbox sweeper.",
              },
              detail: {
                url: `${origin}/api/v1/deals/{deal_id}`,
                method: "GET",
                auth: "required",
              },
              programmatic_lock: {
                url: `${origin}/api/v1/deals/{deal_id}/programmatic-lock`,
                method: "POST",
                description: "Algorithmic acceptance — returns signed contract payload.",
              },
              m2m_execute: {
                url: `${origin}/api/m2m/execute`,
                method: "POST",
                description:
                  "Headless execution against a live VDR token inside the 60s Time-in-Force window.",
                body: {
                  vdr_token: "string",
                  signature_hash: "string",
                  stripe_customer_id: "string",
                  buyer_reference: "string (optional)",
                },
              },
              marketplace: { url: `${origin}/marketplace`, auth: "none" },
            },
            fields: FIELDS,
            example: {
              deal_id: "00000000-0000-0000-0000-000000000000",
              address: "1420 Courtyard Cir",
              city: "Aurora",
              state: "IL",
              zip: "60504",
              asset_type: "SFR",
              arv: 285000,
              estimated_repairs: 42000,
              offer_price: 128000,
              assignment_fee: 29500,
              total_to_buyer: 157500,
              spread: 29500,
              title_purity_score: 92,
              title_status: "Insured",
              fema_zone_clear: true,
              projected_post_sale_tax: 6100,
              confidence_score: 88,
              liquidity_bucket: "HOT",
              contract_state: "UNSENT",
              vdr_url: `${origin}/api/public/vdr/<token>`,
              buy_link: `${origin}/api/public/checkout/create-session?deal=<deal_id>`,
              marketplace_url: `${origin}/marketplace`,
              updated_at: "2026-01-01T00:00:00.000Z",
            },
          },
          { headers: { ...CORS, "Cache-Control": "public, max-age=600" } },
        );
      },
    },
  },
});
