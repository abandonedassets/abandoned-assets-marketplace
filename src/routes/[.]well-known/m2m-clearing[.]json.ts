// Machine autodiscovery manifest — institutional crawlers index this path to
// auto-register against the clearing terminal without human interaction.
import { createFileRoute } from "@tanstack/react-router";

const ORIGIN = "https://abandonedasset.online";

const MANIFEST = {
  protocol_version: "1.0-M2M",
  clearing_terminal: "abandonedasset.online",
  registration_endpoint: `${ORIGIN}/api/public/register-buyer`,
  accept_endpoint: `${ORIGIN}/api/public/v1/m2m/accept`,
  settlement_hook: `${ORIGIN}/api/public/hooks/stripe-settlement`,
  openapi: `${ORIGIN}/api/v1/spec`,
  supported_auth: ["HMAC-SHA256", "BEARER"],
  signing_algorithms: ["HMAC-SHA256"],
  supported_asset_classes: [
    "COMMERCIAL",
    "MULTIFAMILY_5PLUS",
    "LIGHT_INDUSTRIAL",
    "NNN_RETAIL",
    "FLEX_STORAGE",
    "COMMERCIAL_LAND",
  ],
  settlement_currencies: ["USD"],
  settlement_lanes: ["STRIPE_SETTLEMENT", "BLUEVINE_WIRE_DIRECT"],
  execution: {
    handshake_window_seconds: 60,
    execution_ttl_ms: 3000,
    preflight_challenge_header: "X-M2M-Challenge",
    preflight_response_header: "X-M2M-Response",
    idempotency_header: "X-Idempotency-Key",
  },
  registration_schema: {
    legal_name: "string",
    ein: "string (9 digits)",
    contact_email: "string",
    webhook_url: "https url",
    target_asset_classes: "string[]",
    min_deal_size_usd: "number",
    max_deal_size_usd: "number",
    target_cap_rate_min: "number",
    public_key: "string (HMAC shared secret, optional)",
  },
} as const;

const HEADERS = {
  "content-type": "application/json",
  "cache-control": "public, max-age=300",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
};

export const Route = createFileRoute("/.well-known/m2m-clearing.json")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: HEADERS }),
      GET: async () => new Response(JSON.stringify(MANIFEST, null, 2), { headers: HEADERS }),
    },
  },
});
