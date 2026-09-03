import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: any) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

/** Live Stripe balance probe for the settlement terminal. */
export const getStripePayoutStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { stripeBalance } = await import("./stripe-payout.server");
    return await stripeBalance();
  });

/** Execute an instant payout of cleared fees to the bank account linked in Stripe. */
export const executeStripePayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { amountUsd: number; dealId?: string | null; description?: string }) => {
    if (!d || typeof d.amountUsd !== "number" || !isFinite(d.amountUsd) || d.amountUsd <= 0) {
      throw new Error("amountUsd must be a positive number");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { stripeInstantPayout } = await import("./stripe-payout.server");
    const result = await stripeInstantPayout({
      amountUsd: data.amountUsd,
      dealId: data.dealId ?? null,
      description: data.description ?? "Settlement fee payout",
    });
    if (!result.ok) console.error("[stripe-payout]", result.error, result.detail);
    return result;
  });
