// Central error telemetry vault + emergency alert dispatcher.
// Logging NEVER throws — callers must not stall on telemetry failures.

type Severity = "ERROR" | "CRITICAL";

export async function logSystemError(opts: {
  route: string;
  error: unknown;
  severity?: Severity;
  context?: Record<string, unknown>;
}): Promise<void> {
  const severity = opts.severity ?? "ERROR";
  const err = opts.error;
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack ?? null) : null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("system_error_logs").insert({
      route: opts.route,
      severity,
      message: message.slice(0, 2000),
      stack: stack ? stack.slice(0, 6000) : null,
      context: (opts.context ?? {}) as never,
    });
    if (severity === "CRITICAL") await maybeAlert(opts.route, message);
  } catch {
    console.error(`[logSystemError:${opts.route}]`, message);
  }
}

// 3 CRITICAL errors inside 60s => one outbound emergency alert.
async function maybeAlert(route: string, message: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 60_000).toISOString();
    const { data } = await supabaseAdmin
      .from("system_error_logs")
      .select("id, alerted")
      .eq("severity", "CRITICAL")
      .gte("created_at", since);

    const rows = data ?? [];
    if (rows.length < 3) return;
    if (rows.some((r: { alerted: boolean }) => r.alerted)) return; // already alerted this burst

    const body = `[ALERT] ${rows.length} critical errors in 60s. Latest: ${route} — ${message.slice(0, 180)}`;
    await dispatchEmergency(body);

    await supabaseAdmin
      .from("system_error_logs")
      .update({ alerted: true })
      .in("id", rows.map((r: { id: string }) => r.id));
  } catch (e) {
    console.error("[maybeAlert]", e);
  }
}

export async function dispatchEmergency(body: string): Promise<void> {
  const hook = process.env["EMERGENCY_ALERT_WEBHOOK"];
  if (hook) {
    try {
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
    } catch (e) {
      console.error("[dispatchEmergency:webhook]", e);
    }
  }
  const to = process.env["ALERT_SMS_TO"];
  if (to) {
    try {
      const { sendSms } = await import("@/lib/alerts.server");
      await sendSms(to, body);
    } catch (e) {
      console.error("[dispatchEmergency:sms]", e);
    }
  }
}

// Wrap any API handler so unhandled failures land in the vault instead of vanishing.
export function withErrorLogging(
  route: string,
  handler: (ctx: { request: Request }) => Promise<Response>,
) {
  return async (ctx: { request: Request }): Promise<Response> => {
    try {
      return await handler(ctx);
    } catch (e) {
      await logSystemError({ route, error: e, severity: "CRITICAL" });
      return Response.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  };
}
