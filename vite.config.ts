// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Render self-hosting: build a Node server bundle (.output/server/index.mjs).
  // Render auto-injects RENDER=true; Lovable/sandbox builds keep the default
  // Cloudflare target untouched.
  ...(process.env.RENDER || process.env.NITRO_PRESET === "node-server"
    ? { nitro: { preset: "node-server" } }
    : {}),
  vite: {
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null,
        devOptions: { enabled: false },
        filename: "sw.js",
        manifest: {
          name: "Abandoned Asset OS — Clearinghouse",
          short_name: "AssetOS",
          description: "Institutional asset clearinghouse, deal tape and capitalization ledger.",
          theme_color: "#0a0a0a",
          background_color: "#0a0a0a",
          display: "standalone",
          start_url: "/",
        },
        workbox: {
          navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: { cacheName: "html-nav", networkTimeoutSeconds: 5 },
            },
            {
              urlPattern: ({ url }) => url.pathname.startsWith("/ledger/"),
              handler: "NetworkFirst",
              options: { cacheName: "ledger-data", networkTimeoutSeconds: 5 },
            },
            {
              urlPattern: ({ url, request }) =>
                url.origin === self.location.origin &&
                (request.destination === "script" ||
                  request.destination === "style" ||
                  request.destination === "font" ||
                  request.destination === "image"),
              handler: "CacheFirst",
              options: { cacheName: "static-assets" },
            },
          ],
        },
      }),
    ],
  },
});
