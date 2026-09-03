// 5-minute health ping for the live Stripe settlement endpoint.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/stripe-webhook-health")({
  server: {
    handlers: {
      GET: async () => run(),
      POST: async () => run(),
    },
  },
});

async function run() {
  try {
    const { pingStripeWebhookHealth } = await import("@/lib/stripe-webhook-health.server");
    const report = await pingStripeWebhookHealth();
    return Response.json({ ...report, at: new Date().toISOString() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    );
  }
}
