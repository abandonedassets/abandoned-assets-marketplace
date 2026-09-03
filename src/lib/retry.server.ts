// System resilience — autonomous retry with exponential backoff.
// Any external hop (webhook, wire dispatch, payout) runs through withRetry so
// a transient failure never drops a link in the closing chain. After the final
// attempt the failure is logged to system_alerts (surfaced in /admin System
// Logs) — never silent.

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  label: string;
  dealId?: string | null;
  metadata?: Record<string, unknown>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function logSystemAlert(input: {
  kind: string;
  severity: "info" | "warn" | "critical";
  message: string;
  dealId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("system_alerts" as never).insert({
      kind: input.kind,
      severity: input.severity,
      message: input.message.slice(0, 1000),
      deal_id: input.dealId ?? null,
      metadata: (input.metadata ?? {}) as never,
    } as never);
  } catch (e) {
    console.error("[retry] alert log failed", e);
  }
}

/** Run `fn`, retrying with exponential backoff. Returns null after exhaustion. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<{ ok: true; value: T; attempts: number } | { ok: false; error: string; attempts: number }> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = opts.baseDelayMs ?? 500;
  let lastErr = "unknown_error";

  for (let i = 1; i <= attempts; i++) {
    try {
      const value = await fn();
      return { ok: true, value, attempts: i };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.error(`[retry:${opts.label}] attempt ${i}/${attempts} failed: ${lastErr}`);
      if (i < attempts) await sleep(base * 2 ** (i - 1));
    }
  }

  await logSystemAlert({
    kind: `retry_exhausted:${opts.label}`,
    severity: "critical",
    message: `${opts.label} failed after ${attempts} attempts — ${lastErr}`,
    dealId: opts.dealId ?? null,
    metadata: { ...(opts.metadata ?? {}), attempts, error: lastErr },
  });

  return { ok: false, error: lastErr, attempts };
}
