// Dead-letter queue for outbound buyer dispatch.
// A timeout or 5xx never strips the 15-minute lock — the payload is parked
// here and replayed by the background retry worker with exponential backoff.

export const DISPATCH_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 6;

export async function routeToDlq(entry: {
  dealId: string;
  boxId?: string | null;
  endpoint?: string | null;
  httpStatus?: number | null;
  error?: string | null;
  payload: unknown;
  source?: string;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("dlq_events").insert({
      source: entry.source ?? "m2m_dispatch",
      deal_id: entry.dealId,
      box_id: entry.boxId ?? null,
      endpoint: entry.endpoint ?? null,
      http_status: entry.httpStatus ?? null,
      error_text: entry.error ? String(entry.error).slice(0, 500) : null,
      payload: entry.payload as never,
      next_retry_at: new Date(Date.now() + 60_000).toISOString(),
    } as never);
    return true;
  } catch (e) {
    console.error("[dlq] park failed", entry.dealId, e);
    return false;
  }
}

export type DlqReport = { ok: boolean; retried: number; resolved: number; error?: string };

/** Replay parked payloads. Fail-forward: one bad row never stalls the sweep. */
export async function retryDlq(limit = 25): Promise<DlqReport> {
  const out: DlqReport = { ok: true, retried: 0, resolved: 0 };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("dlq_events")
      .select("id, deal_id, box_id, endpoint, payload, attempts")
      .is("resolved_at", null)
      .lte("next_retry_at", new Date().toISOString())
      .order("next_retry_at", { ascending: true })
      .limit(limit);

    for (const row of ((data ?? []) as Record<string, any>[])) {
      const attempts = Number(row["attempts"] ?? 0) + 1;
      let ok = false;
      let status: number | null = null;
      let err: string | null = null;
      try {
        if (!row["endpoint"]) throw new Error("no_endpoint");
        const resp = await fetch(String(row["endpoint"]), {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-DLQ-Retry": String(attempts) },
          body: JSON.stringify(row["payload"] ?? {}),
          signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
        });
        status = resp.status;
        ok = resp.status < 500 && resp.status !== 408 && resp.status !== 429;
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      out.retried += 1;

      const backoff = Math.min(2 ** attempts, 60) * 60_000;
      try {
        await supabaseAdmin
          .from("dlq_events")
          .update({
            attempts,
            http_status: status,
            error_text: err,
            resolved_at: ok || attempts >= MAX_ATTEMPTS ? new Date().toISOString() : null,
            next_retry_at: new Date(Date.now() + backoff).toISOString(),
          } as never)
          .eq("id", row["id"]);
      } catch (e) {
        console.error("[dlq] update failed", row["id"], e);
      }
      if (ok) out.resolved += 1;
    }
    return out;
  } catch (e) {
    return { ...out, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
