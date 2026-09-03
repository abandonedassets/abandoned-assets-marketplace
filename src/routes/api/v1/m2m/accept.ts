// POST /api/v1/m2m/accept — sub-second M2M handshake alias.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/m2m/accept")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { M2M_CORS } = await import("@/lib/m2m-algo.server");
        return new Response(null, { status: 204, headers: M2M_CORS });
      },
      POST: async ({ request }) => {
        const { handleM2MAccept } = await import("@/lib/m2m-algo.server");
        return handleM2MAccept(request);
      },
    },
  },
});
