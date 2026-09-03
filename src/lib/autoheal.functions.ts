import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Zero-touch exception healing. Flips every manual-review / stale row into
 * 'Auto-Enrichment-Pending' so the backend enrichment pass can resolve the
 * missing ZIP / price. Unresolvable rows are archived by the backend as
 * 'Auto_Archived_Bad_Data'. No human data entry anywhere in this path.
 */
export const runAutoHeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr || !isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error: selErr } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id")
      .or("manual_review.eq.true,is_stale.eq.true")
      .not(
        "status",
        "in",
        "(Funds-Cleared,Funds-Suspended,Closed,Dead,Auto_Archived_Bad_Data,In-Escrow,Buyer-Signed,Wire-Sent,Locked-Escrow-Pending,SETTLED_ATOMIC)",
      )
      .not(
        "payout_status",
        "in",
        "(WIRE_PENDING_VERIFICATION,AWAITING_INBOUND_WIRE,IN_TRANSIT,PENDING,SETTLED_PAID)",
      )
      .limit(1000);
    if (selErr) throw new Error(selErr.message);

    const ids = (rows ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) return { ok: true as const, healed: 0 };

    const { error: updErr } = await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        status: "Auto-Enrichment-Pending",
        manual_review: false,
        is_stale: false,
        updated_at: new Date().toISOString(),
      } as never)
      .in("id", ids);
    if (updErr) throw new Error(updErr.message);

    return { ok: true as const, healed: ids.length };
  });

/**
 * Full diagnostic override. Clears exception flags, sanitizes malformed rows,
 * force-flushes the dispatch queue and drains the resilient outbox so the
 * live stream is restored in one tap.
 */
export const runDiagnosticOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr || !isAdmin) throw new Error("Forbidden");

    const { runDiagnosticSweep } = await import("@/lib/self-heal.server");
    const report = await runDiagnosticSweep();
    return { ok: true as const, report };
  });
