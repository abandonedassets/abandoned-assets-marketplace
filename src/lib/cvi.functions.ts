import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";

export type CviDaily = { day: string; avg_hours: number; n: number };
export type CviMetrics = {
  current_avg_hours: number;
  current_sample: number;
  previous_avg_hours: number;
  previous_sample: number;
  daily: CviDaily[];
  generated_at: string;
};

export const getCviMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("cvi_metrics");
    if (error) throw new Error(error.message);
    return data as unknown as CviMetrics;
  });
