import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ExecutionRow } from "@/lib/execution-states";

export type ExecutionSnapshot = {
  at: string;
  rows: ExecutionRow[];
};

/** One-shot truth snapshot. No polling: live deltas arrive over the realtime stream. */
export const getExecutionSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ExecutionSnapshot> => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id,address,zip,status,payout_status,optimized_acquisition_premium,updated_at")
      .order("updated_at", { ascending: false })
      .limit(2000);

    return { at: new Date().toISOString(), rows: (data ?? []) as ExecutionRow[] };
  });
