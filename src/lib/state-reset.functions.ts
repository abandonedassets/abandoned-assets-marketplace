// Read-only forensics for assets that fall back to REVERSE_STRIKE_READY on the tape.
// Never mutates pipeline state, routing rules, or payload schemas.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type StateResetRow = {
  pipeline_item_id: string;
  at: string;
  from_status: string | null;
  to_status: string | null;
  source: string;
  detail: string;
};

/** Statuses that render as REVERSE_STRIKE_READY (unmapped fallback) in the terminal. */
const FALLBACK_STATUSES = [
  "Pending-Underwriting",
  "Auto-Enrichment-Pending",
  "Scout",
  "New",
  "Rejected",
];

export const getStateResetDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StateResetRow[]> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const out = new Map<string, StateResetRow>();

    // 1. Raw status transitions back into an unmapped (fallback) status.
    const { data: hist } = await supabaseAdmin
      .from("pipeline_status_history")
      .select("pipeline_item_id,old_status,new_status,changed_at")
      .in("new_status", FALLBACK_STATUSES)
      .order("changed_at", { ascending: false })
      .limit(2000);

    for (const h of (hist ?? []) as Record<string, any>[]) {
      const id = h["pipeline_item_id"];
      if (!id || out.has(id)) continue;
      out.set(id, {
        pipeline_item_id: id,
        at: h["changed_at"],
        from_status: h["old_status"] ?? null,
        to_status: h["new_status"] ?? null,
        source: "status_transition",
        detail: `${h["old_status"] ?? "?"} → ${h["new_status"]}`,
      });
    }

    // 2. Audit-log reasons (self-heal sweeps, ARV re-underwrite, TIF expiry).
    const { data: audit } = await supabaseAdmin
      .from("system_audit_logs")
      .select("pipeline_item_id,event_type,reason,from_status,to_status,created_at")
      .not("pipeline_item_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000);

    for (const a of (audit ?? []) as Record<string, any>[]) {
      const id = a["pipeline_item_id"];
      if (!id) continue;
      const prev = out.get(id);
      if (prev && prev.at >= a["created_at"]) continue;
      out.set(id, {
        pipeline_item_id: id,
        at: a["created_at"],
        from_status: a["from_status"] ?? null,
        to_status: a["to_status"] ?? null,
        source: a["event_type"] ?? "audit",
        detail: String(a["reason"] ?? a["event_type"] ?? "").slice(0, 200),
      });
    }

    // 3. Hard errors: exception queue + execution DLQ (HTTP codes / timeouts).
    const { data: exc } = await supabaseAdmin
      .from("exception_queue")
      .select("pipeline_item_id,last_error,retry_count,last_retry_at,created_at,resolved_at")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(1000);

    for (const e of (exc ?? []) as Record<string, any>[]) {
      const id = e["pipeline_item_id"];
      if (!id) continue;
      const at = e["last_retry_at"] ?? e["created_at"];
      const prev = out.get(id);
      if (prev && prev.at >= at) continue;
      out.set(id, {
        pipeline_item_id: id,
        at,
        from_status: null,
        to_status: null,
        source: "exception_queue",
        detail: `${String(e["last_error"] ?? "unclassified").slice(0, 180)} (retries ${e["retry_count"] ?? 0})`,
      });
    }

    const { data: dlq } = await supabaseAdmin
      .from("execution_dlq")
      .select("deal_id,reason,detail,replay_attempts,created_at,resolved")
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(1000);

    for (const d of (dlq ?? []) as Record<string, any>[]) {
      const id = d["deal_id"];
      if (!id) continue;
      const prev = out.get(id);
      if (prev && prev.at >= d["created_at"]) continue;
      out.set(id, {
        pipeline_item_id: id,
        at: d["created_at"],
        from_status: null,
        to_status: null,
        source: "execution_dlq",
        detail: `${d["reason"] ?? "dlq"}: ${String(d["detail"] ?? "").slice(0, 160)}`,
      });
    }

    return [...out.values()];
  });
