import { defineNitroConfig } from "nitropack/config";

export default defineNitroConfig({
  preset: process.env.NITRO_PRESET || "node-server",
  serveStatic: false,

  // File-based routing is disabled by default in this standalone Nitro setup.
  // Scan the existing server directory, but keep the Stripe settlement handler
  // excluded until its authorization and live webhook configuration are reviewed.
  serverDir: "./server",
  ignore: ["api/public/hooks/stripe-settlement.post.ts"],

  routeRules: {
    "/api/public/health": {
      cors: true,
      headers: { "cache-control": "no-store" },
    },
    "/api/public/hooks/mercury-webhook": {
      cors: true,
      headers: { "cache-control": "no-store" },
    },
    "/api/public/b2b-intake-page": {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      },
    },
    "/api/private/b2b-intake": {
      headers: { "cache-control": "no-store" },
    },
  },
});
