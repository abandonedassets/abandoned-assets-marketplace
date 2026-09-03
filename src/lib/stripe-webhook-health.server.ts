// Pings the live Stripe settlement endpoint every 5 minutes.
// Alerts ONLY on failure (non-2xx / unreachable).
const endpoint = () =>
  `${(process.env["PUBLIC_APP_URL"] ?? process.env["PUBLIC_SITE_URL"] ?? "https://www.abandonedasset.online").replace(/\/$/, "")}/api/public/hooks/stripe-settlement`;

export async function pingStripeWebhookHealth() {
  const ENDPOINT = endpoint();
  const started = Date.now();
  let status = 0;
  let error: string | null = null;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-health-check": "1" },
      body: JSON.stringify({ health_check: true, at: new Date().toISOString() }),
      redirect: "manual",
    });
    status = res.status;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // Endpoint is healthy if it answers at all without a redirect/5xx.
  // Signature rejection (400/401) still proves the route is live and raw-body parsing runs.
  const ok = !error && status > 0 && status < 500 && status !== 404 && !(status >= 300 && status < 400);
  const latency_ms = Date.now() - started;

  if (!ok) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("system_alerts").insert({
        kind: "STRIPE_WEBHOOK_ENDPOINT_DOWN",
        severity: "critical",
        message: `Stripe settlement endpoint unhealthy (status ${status}${error ? `, ${error}` : ""}).`,
        metadata: { endpoint: ENDPOINT, status, error, latency_ms } as never,
      } as never);
      const { notifyAdmin } = await import("@/lib/notify.server");
      await notifyAdmin(
        `🚨 Stripe webhook endpoint unhealthy — status ${status}${error ? ` (${error})` : ""}. ${ENDPOINT}`,
        true,
      );
    } catch (e) {
      console.error("[stripe-health] alert write failed", e);
    }
  }

  return { ok, status, error, latency_ms, endpoint: ENDPOINT };
}
