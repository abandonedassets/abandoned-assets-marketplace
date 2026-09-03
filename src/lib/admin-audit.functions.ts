import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

export type AuditSnapshot = {
  ingest_runs: Array<{
    id: string;
    source: string;
    status: string;
    total_rows: number;
    inserted: number;
    deduped: number;
    dlq: number;
    note: string | null;
    created_at: string;
  }>;
  pipeline_recent: Array<{
    id: string;
    zip: string;
    status: string;
    escrow_status: string | null;
    base_contract_price: number;
    optimized_acquisition_premium: number | null;
    matched_buyer_id: string | null;
    bundle_id: string | null;
    updated_at: string;
    created_at: string;
  }>;
  pipeline_status_counts: Record<string, number>;
  event_stream: Array<{
    id: string;
    kind: "dispatch" | "lock" | "clear" | "match" | "bundle" | "ingest" | "dlq";
    at: string;
    summary: string;
    success: boolean | null;
  }>;
  counterparty_activity: Array<{
    endpoint_id: string;
    endpoint_name: string;
    last_at: string | null;
    total_24h: number;
    success_24h: number;
    fail_24h: number;
  }>;
  dlq_recent: Array<{
    id: string;
    error_reason: string | null;
    retry_count: number;
    created_at: string;
    source_ip: string | null;
  }>;
  generated_at: string;
};

export const getSystemAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AuditSnapshot> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      ingestRes,
      pipeRes,
      dispatchRes,
      endpointsRes,
      dlqRes,
      allStatusRes,
    ] = await Promise.all([
      supabaseAdmin
        .from("ingest_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("closing_pipeline_items")
        .select(
          "id, zip, status, escrow_status, base_contract_price, optimized_acquisition_premium, matched_buyer_id, bundle_id, updated_at, created_at, cleared_at, locked_at",
        )
        .order("updated_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("routing_dispatch_log")
        .select(
          "id, endpoint_id, dispatched_at, http_status, latency_ms, success, error_text, routing_endpoints(name)",
        )
        .gte("dispatched_at", since)
        .order("dispatched_at", { ascending: false })
        .limit(200),
      supabaseAdmin.from("routing_endpoints").select("id, name"),
      supabaseAdmin
        .from("dead_letter_queue")
        .select("id, error_reason, retry_count, created_at, source_ip")
        .order("created_at", { ascending: false })
        .limit(25),
      supabaseAdmin.from("closing_pipeline_items").select("status"),
    ]);

    if (ingestRes.error) throw new Error(ingestRes.error.message);
    if (pipeRes.error) throw new Error(pipeRes.error.message);
    if (dispatchRes.error) throw new Error(dispatchRes.error.message);
    if (endpointsRes.error) throw new Error(endpointsRes.error.message);
    if (dlqRes.error) throw new Error(dlqRes.error.message);
    if (allStatusRes.error) throw new Error(allStatusRes.error.message);

    const pipeline_status_counts: Record<string, number> = {};
    for (const r of allStatusRes.data ?? []) {
      const s = String((r as any).status);
      pipeline_status_counts[s] = (pipeline_status_counts[s] ?? 0) + 1;
    }

    // Counterparty activity per endpoint over last 24h
    const cpMap = new Map<
      string,
      { endpoint_id: string; endpoint_name: string; last_at: string | null; total_24h: number; success_24h: number; fail_24h: number }
    >();
    for (const ep of endpointsRes.data ?? []) {
      cpMap.set((ep as any).id, {
        endpoint_id: (ep as any).id,
        endpoint_name: (ep as any).name,
        last_at: null,
        total_24h: 0,
        success_24h: 0,
        fail_24h: 0,
      });
    }
    for (const d of dispatchRes.data ?? []) {
      const row: any = d;
      const cp = cpMap.get(row.endpoint_id);
      if (!cp) continue;
      cp.total_24h += 1;
      if (row.success) cp.success_24h += 1;
      else cp.fail_24h += 1;
      if (!cp.last_at || row.dispatched_at > cp.last_at) cp.last_at = row.dispatched_at;
    }

    // Event stream — fuse signals into one chronological feed
    const events: AuditSnapshot["event_stream"] = [];
    for (const d of dispatchRes.data ?? []) {
      const row: any = d;
      events.push({
        id: `disp-${row.id}`,
        kind: "dispatch",
        at: row.dispatched_at,
        summary: `Dispatch → ${row.routing_endpoints?.name ?? "endpoint"} (${row.http_status ?? "?"}, ${row.latency_ms ?? "?"}ms)${row.error_text ? ` — ${row.error_text.slice(0, 120)}` : ""}`,
        success: row.success,
      });
    }
    for (const p of pipeRes.data ?? []) {
      const row: any = p;
      if (row.cleared_at) {
        events.push({
          id: `clear-${row.id}`,
          kind: "clear",
          at: row.cleared_at,
          summary: `Cleared ${row.zip} @ $${Number(row.base_contract_price).toLocaleString()}`,
          success: true,
        });
      }
      if (row.locked_at) {
        events.push({
          id: `lock-${row.id}`,
          kind: "lock",
          at: row.locked_at,
          summary: `Locked ${row.zip} for escrow`,
          success: true,
        });
      }
      if (row.matched_buyer_id) {
        events.push({
          id: `match-${row.id}`,
          kind: "match",
          at: row.updated_at,
          summary: `Matched ${row.zip} to buyer ${String(row.matched_buyer_id).slice(0, 8)}`,
          success: true,
        });
      }
    }
    for (const i of ingestRes.data ?? []) {
      const row: any = i;
      events.push({
        id: `ing-${row.id}`,
        kind: "ingest",
        at: row.created_at,
        summary: `Ingest ${row.source}: ${row.status} (rows=${row.total_rows}, ins=${row.inserted}, dlq=${row.dlq})${row.note ? ` — ${row.note.slice(0, 120)}` : ""}`,
        success: row.status === "ok" || row.status === "success",
      });
    }
    for (const d of dlqRes.data ?? []) {
      const row: any = d;
      events.push({
        id: `dlq-${row.id}`,
        kind: "dlq",
        at: row.created_at,
        summary: `DLQ: ${row.error_reason ?? "unknown"} (retries=${row.retry_count})`,
        success: false,
      });
    }
    events.sort((a, b) => (a.at < b.at ? 1 : -1));

    return {
      ingest_runs: (ingestRes.data ?? []) as any,
      pipeline_recent: (pipeRes.data ?? []).map((r: any) => ({
        id: r.id,
        zip: r.zip,
        status: String(r.status),
        escrow_status: r.escrow_status,
        base_contract_price: Number(r.base_contract_price ?? 0),
        optimized_acquisition_premium: r.optimized_acquisition_premium == null ? null : Number(r.optimized_acquisition_premium),
        matched_buyer_id: r.matched_buyer_id,
        bundle_id: r.bundle_id,
        updated_at: r.updated_at,
        created_at: r.created_at,
      })),
      pipeline_status_counts,
      event_stream: events.slice(0, 50),
      counterparty_activity: Array.from(cpMap.values()).sort(
        (a, b) => b.total_24h - a.total_24h,
      ),
      dlq_recent: (dlqRes.data ?? []) as any,
      generated_at: new Date().toISOString(),
    };
  });
