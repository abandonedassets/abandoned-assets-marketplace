import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";

/** Manual "Execute Settlement" trigger from the terminal.
 *  Always runs with the temporal window bypassed: an operator-initiated
 *  dispatch under a locked facility must not wait on T-9d/T-10d. */
export const executeSettlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { runAutoSettleSweep } = await import("@/lib/auto-settle.server");
    return await runAutoSettleSweep(200, { bypassWindow: true });
  });

/** DSCR term-sheet execution flag — flips Bluevine routing to VERIFIED. */
export const setDscrFacility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { executed: boolean }) => ({ executed: Boolean(d?.executed) }))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { setDscrFacilityExecuted, runAutoSettleSweep } = await import(
      "@/lib/auto-settle.server"
    );
    await setDscrFacilityExecuted(data.executed);
    const report = data.executed
      ? await runAutoSettleSweep(200, { bypassWindow: true })
      : null;
    return { executed: data.executed, report };
  });


// Public read: only exposes whether the autopilot flag is on (no PII, no data).
// Kept unauthenticated because the terminal at "/" renders during SSR with no bearer token.
export const getAutoSettleState = createServerFn({ method: "GET" }).handler(
  async () => {
    const { isAutoSettleEnabled } = await import("@/lib/auto-settle.server");
    return { enabled: await isAutoSettleEnabled() };
  },
);

export const toggleAutoSettle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { enabled: boolean }) => ({ enabled: Boolean(d?.enabled) }))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { setAutoSettleEnabled } = await import("@/lib/auto-settle.server");
    return { enabled: await setAutoSettleEnabled(data.enabled) };
  });
