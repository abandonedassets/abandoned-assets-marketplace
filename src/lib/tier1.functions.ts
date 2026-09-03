import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getTier1DarkPool = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tier1_dark_pool_view" as any)
      .select("*")
      .order("fee", { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, any>>;
    const totals = rows.reduce(
      (acc, r) => {
        acc.count += 1;
        acc.fees += Number(r.fee ?? 0);
        acc.notional += Number(r.base_contract_price ?? 0);
        return acc;
      },
      { count: 0, fees: 0, notional: 0 }
    );
    return { rows, totals };
  });
