import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type LockEvent = {
  id: string;
  deal_id: string;
  at: string;
  from: string | null;
  to: string | null;
  reason: string;
};

export type OutboundState = {
  deal_id: string;
  state: "ACKNOWLEDGED" | "PENDING DISPATCH" | "TIMED OUT" | "NONE";
  at: string | null;
};

export type LockDiagnostics = {
  at: string;
  events: LockEvent[];
  outbound: OutboundState[];
};

const ACK = new Set(["DELIVERED", "OPENED", "CLICKED", "EXECUTED"]);
const TIMEOUT_MS = 30 * 60 * 1000;

/** Lock lifecycle + outbound dispatch telemetry for the 1031 terminal. */
export const getLockDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LockDiagnostics> => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [histRes, dlvRes] = await Promise.all([
      supabaseAdmin
        .from("pipeline_status_history")
        .select("id,pipeline_item_id,old_status,new_status,old_escrow_status,new_escrow_status,changed_at")
        .order("changed_at", { ascending: false })
        .limit(60),
      supabaseAdmin
        .from("offer_delivery_logs")
        .select("pipeline_item_id,status,created_at")
        .not("pipeline_item_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(400),
    ]);

    const events: LockEvent[] = (histRes.data ?? []).map((r: any) => {
      const from = r.old_status ?? r.old_escrow_status ?? null;
      const to = r.new_status ?? r.new_escrow_status ?? null;
      let reason = "STATE_TRANSITION";
      if (to === "Funds-Cleared" || to === "Closed") reason = "SETTLED";
      else if (to === "Auto_Archived_Bad_Data" || to === "Dead") reason = "PURGED_STALE_LEAD";
      else if (to === "Queued-For-Tomorrow") reason = "HOLD_EXPIRED_REQUEUED";
      else if (from === "In-Escrow" && to !== "In-Escrow") reason = "ESCROW_RELEASE";
      return {
        id: String(r.id),
        deal_id: String(r.pipeline_item_id),
        at: r.changed_at,
        from,
        to,
        reason,
      };
    });

    const seen = new Map<string, OutboundState>();
    const now = Date.now();
    for (const r of (dlvRes.data ?? []) as any[]) {
      const id = String(r.pipeline_item_id);
      if (seen.has(id)) continue;
      const age = now - Date.parse(r.created_at);
      const state: OutboundState["state"] = ACK.has(r.status)
        ? "ACKNOWLEDGED"
        : age > TIMEOUT_MS
          ? "TIMED OUT"
          : "PENDING DISPATCH";
      seen.set(id, { deal_id: id, state, at: r.created_at });
    }

    return { at: new Date().toISOString(), events, outbound: [...seen.values()] };
  });

/** Sandbox: force a wire-in-flight deal through to cleared funds. */
export const simulateWireSettlement = createServerFn({ method: "POST" })
  .inputValidator((d: { dealId?: string | null }) => ({ dealId: d?.dealId ?? null }))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let dealId = data.dealId;
    if (!dealId) {
      const { data: row } = await supabaseAdmin
        .from("closing_pipeline_items")
        .select("id")
        .is("cleared_at", null)
        .not("m2m_expires_at", "is", null)
        .order("wire_instructed_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      dealId = (row as any)?.id ?? null;
    }
    if (!dealId) return { ok: false, message: "No locked deal available to settle." };

    const { data: deal } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id,optimized_acquisition_premium,cleared_at")
      .eq("id", dealId)
      .maybeSingle();
    const fee = Number((deal as any)?.optimized_acquisition_premium ?? 0) || 0;

    const { error: rpcErr } = await supabaseAdmin.rpc("clear_funds_idempotent" as never, {
      _deal_id: dealId,
      _cleared_amount: fee,
      _stripe_event_id: `sim_${dealId}`,
    } as never);

    if (rpcErr) {
      await supabaseAdmin
        .from("closing_pipeline_items")
        .update({ cleared_at: new Date().toISOString(), cleared_amount: fee })
        .eq("id", dealId);
    }

    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({ status: "Funds-Cleared", lock_phase: "SETTLED" })
      .eq("id", dealId);

    return { ok: true, dealId, fee, message: `SETTLEMENT CONFIRMED · ${dealId.slice(0, 8)}` };
  });
