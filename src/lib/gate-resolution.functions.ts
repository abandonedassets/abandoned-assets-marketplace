import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";

export const listGateResolution = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("gate_resolution_state" as never)
      .select(
        "id,pipeline_item_id,gate,state,attempts,last_attempt_at,next_attempt_at,last_detail,external_ref",
      )
      .order("last_attempt_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, any>>;
    return {
      rows,
      totals: {
        dispatching: rows.filter((r) => r["state"] === "AUTO_DISPATCHING").length,
        awaiting: rows.filter((r) => r["state"] === "AWAITING_EXTERNAL_RESPONSE").length,
        resolved: rows.filter((r) => r["state"] === "RESOLVED").length,
        failed: rows.filter((r) => r["state"] === "FAILED").length,
      },
    };
  });

export const kickGateResolution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as never);
    const { runGateResolution } = await import("@/lib/gate-resolution.server");
    return runGateResolution(40);
  });
