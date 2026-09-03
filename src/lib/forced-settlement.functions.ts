import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";

/** Force a direct ACH pull against a buyer's mandate (Reverse Capital Flow). */
export const forceCapitalPull = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { dealId: string; buyerId: string; amountUsd: number }) => ({
    dealId: String(d?.dealId ?? ""),
    buyerId: String(d?.buyerId ?? ""),
    amountUsd: Number(d?.amountUsd ?? 0),
  }))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { pullBuyerCapital } = await import("@/lib/forced-settlement.server");
    return await pullBuyerCapital(data);
  });

/** Run the programmatic title abstract and set the wire authorization flag. */
export const runTitleUnderwrite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { dealId: string }) => ({ dealId: String(d?.dealId ?? "") }))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { underwriteTitle } = await import("@/lib/forced-settlement.server");
    return await underwriteTitle(data.dealId);
  });

/** Dispatch proprietary dry powder to the seller ahead of buyer clearing. */
export const dispatchFlashBridge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { dealId: string }) => ({ dealId: String(d?.dealId ?? "") }))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { flashBridge } = await import("@/lib/forced-settlement.server");
    return await flashBridge(data.dealId);
  });
