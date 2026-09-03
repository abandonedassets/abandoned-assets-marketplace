import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";

export const getTriPartyLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as never);
    const { listSweepLedger, getFacility, dailyAccruedInterest } = await import(
      "@/lib/debt-sweep.server"
    );
    const facility = await getFacility();
    return {
      facility,
      daily_interest_usd: dailyAccruedInterest(facility),
      rows: await listSweepLedger(50),
    };
  });

export const triggerAtomicDebtSweep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as never);
    const { runAtomicDebtSweep } = await import("@/lib/debt-sweep.server");
    return await runAtomicDebtSweep(100);
  });
