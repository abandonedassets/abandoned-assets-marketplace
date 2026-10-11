import { defineNitroConfig } from "nitropack/config";

export default defineNitroConfig({
  preset: process.env.NITRO_PRESET || "node-server",
  serveStatic: false,

  // Explicit registration keeps the intended API surface small. Do not set
  // serverDir to scan every file under server/api: that would also activate
  // the unreviewed Stripe settlement webhook in this legacy runtime.
  routes: {
    "/api/public/health": {
      handler: "./server/api/public/health.get.ts",
      method: "GET",
    },
    "/api/public/hooks/mercury-webhook": {
      handler: "./server/api/public/hooks/mercury-webhook-bridge.ts",
    },
    "/api/public/b2b-intake-page": {
      handler: "./server/api/public/b2b-intake-page.get.ts",
      method: "GET",
    },
    "/api/private/b2b-intake": {
      handler: "./server/api/private/b2b-intake.post.ts",
      method: "POST",
    },
  },

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
