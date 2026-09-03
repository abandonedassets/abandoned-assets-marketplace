// POST /api/public/register-buyer — autonomous institutional buyer registration.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/register-buyer")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { REGISTER_CORS } = await import("@/lib/register-buyer.server");
        return new Response(null, { status: 204, headers: REGISTER_CORS });
      },
      POST: async ({ request }) => {
        const { handleRegisterBuyer } = await import("@/lib/register-buyer.server");
        return handleRegisterBuyer(request);
      },
    },
  },
});
