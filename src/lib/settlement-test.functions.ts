import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Env readiness for the money path (booleans only — never the values). */
export const getSettlementReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({
    // Stripe is the sole payout rail. Bank accounts live in the Stripe
    // Dashboard, so no routing/account numbers are needed as secrets.
    stripe_restricted_key: Boolean(process.env["STRIPE_RESTRICTED_KEY"] ?? process.env["STRIPE_SECRET_KEY"]),
  }));


/** Lowest-fee uncleared deals — safest candidates for a controlled test. */
export const listTestCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("closing_pipeline_items")
      .select(
        "id, address, city, state, zip, status, optimized_acquisition_premium, cleared_at, cleared_amount, verification_status, stripe_session_id, stripe_session_url",
      )
      .is("cleared_at", null)
      .gt("optimized_acquisition_premium", 0)
      .order("optimized_acquisition_premium", { ascending: true })
      .limit(15);
    if (error) throw error;
    return { rows: (data ?? []) as Array<Record<string, any>> };
  });

/** Issue (or reuse) the Bluevine ACH debit request for the selected deal. */
export const mintTestInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { dealId: string; email?: string | null }) => {
    if (!d?.dealId) throw new Error("dealId required");
    return { dealId: d.dealId, email: d.email?.trim() || null };
  })
  .handler(async ({ data }) => {
    const { createAchInvoice } = await import("@/lib/bluevine.server");
    return createAchInvoice(data.dealId, data.email);
  });

/** Poll the row — strict database truth, no frontend guessing. */
export const checkSettlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { dealId: string }) => {
    if (!d?.dealId) throw new Error("dealId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("closing_pipeline_items")
      .select(
        "id, status, escrow_status, cleared_at, cleared_amount, verification_status, stripe_session_id, stripe_session_url, optimized_acquisition_premium, updated_at",
      )
      .eq("id", data.dealId)
      .maybeSingle();
    if (error) throw error;
    return { row: (row ?? null) as Record<string, any> | null };
  });
