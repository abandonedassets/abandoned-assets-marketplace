import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () =>
        new Response("OK", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    },
  },
});
