// Silent Executive Telemetry — fire-and-forget outbound webhook.
// Compatible with Discord (uses { content }) and Slack (uses { text }).
// Failures are swallowed; telemetry MUST NEVER stall the pipeline.

export async function notifyAdmin(message: string, critical = false): Promise<void> {
  // Critical failures bypass standard logging and fire to the dedicated
  // CRITICAL_SYSTEM_ALERT_URL node first (mobile/monitoring alert card).
  const url = (critical && process.env.CRITICAL_SYSTEM_ALERT_URL) || process.env.ADMIN_NOTIFY_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message, text: message }),
    });
  } catch (e) {
    console.error("[notifyAdmin] webhook failed:", e);
  }
}

export function fmtUsd(n: number): string {
  if (!isFinite(n)) return "$0";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
