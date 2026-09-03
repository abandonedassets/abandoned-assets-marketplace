import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  compatibilityDate: "2026-09-03",
  // A root nitro.config.ts takes precedence over inline vite.config.ts nitro
  // options — so the Render node-server preset MUST be pinned here, not there.
  // Local/Lovable builds (no RENDER env) keep the default cloudflare-module target.
  ...(process.env.RENDER || process.env.NITRO_PRESET === "node-server"
    ? { preset: "node-server" as const }
    : {}),

  routeRules: {
    "/api/public/health": {
      cors: true,
    },
    "/api/public/hooks/**": {
      cors: true,
    },
  },

  server: {
    host: process.env.NITRO_HOST || "0.0.0.0",
    port: Number(process.env.PORT || 10000),
  },
});
