import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listLedgerAnomalies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("ledger_anomalies" as any)
      .select(
        "id,pipeline_item_id,anomaly_code,severity,message,details,status,first_detected_at,last_detected_at,resolved_at",
      )
      .order("status", { ascending: true })
      .order("last_detected_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, any>>;
    const open = rows.filter((r) => r.status === "open");
    return {
      rows,
      totals: {
        open: open.length,
        critical: open.filter((r) => r.severity === "critical").length,
        resolved: rows.length - open.length,
      },
    };
  });

export const runLedgerAnomalyScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("scan_ledger_anomalies" as never);
    if (error) throw error;
    return { ok: true, detected: (data ?? []) as Array<Record<string, any>> };
  });

export const resolveLedgerAnomaly = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ledger_anomalies" as any)
      .update({ status: "resolved", resolved_at: new Date().toISOString() } as never)
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
