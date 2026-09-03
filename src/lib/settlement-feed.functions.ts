import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SettlementFeedRow = {
  id: string;
  address: string | null;
  zip: string | null;
  memo_id: string;
  buyer_name: string | null;
  fee_usd: number;
  settled_at: string;
  days_to_deposit: number;
  deposit_date: string;
  cleared: boolean;
};

/** Add N business days to a date. */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}

export const getSettlementFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SettlementFeedRow[]> => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,address,zip,external_id,matched_buyer_id,optimized_acquisition_premium,payout_status,payout_at,cleared_at,cleared_amount",
      )
      .eq("payout_status", "SETTLED_PAID")
      .order("payout_at", { ascending: false })
      .limit(40);

    const now = Date.now();
    return ((data ?? []) as any[]).map((r) => {
      const settledAt = String(r.payout_at ?? r.cleared_at ?? new Date().toISOString());
      const deposit = addBusinessDays(new Date(settledAt), 2);
      const daysLeft = Math.max(
        0,
        Math.ceil((deposit.getTime() - now) / 86_400_000),
      );
      return {
        id: r.id,
        address: r.address ?? null,
        zip: r.zip ?? null,
        memo_id: `AA-${String(r.id).slice(0, 8).toUpperCase()}`,
        buyer_name: r.matched_buyer_id ? String(r.matched_buyer_id).slice(0, 8) : null,
        fee_usd: Number(r.cleared_amount ?? r.optimized_acquisition_premium ?? 0),
        settled_at: settledAt,
        days_to_deposit: daysLeft,
        deposit_date: deposit.toISOString().slice(0, 10),
        cleared: daysLeft === 0,
      };
    });
  });

export type WireSignal = {
  id: string;
  address: string | null;
  zip: string | null;
  memo_id: string;
  amount_usd: number;
  wire_instructed_at: string;
  expires_at: string | null;
  rail: string;
};

/** Deals inside the protected 24h wire window — Phase B of two-phase locking. */
export const getWireSignals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WireSignal[]> => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id,address,zip,optimized_acquisition_premium,wire_instructed_at,m2m_expires_at,lock_phase,cleared_at")
      .eq("lock_phase", "WIRE_IN_FLIGHT")
      .is("cleared_at", null)
      .order("wire_instructed_at", { ascending: false })
      .limit(25);

    return ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      address: r.address ?? null,
      zip: r.zip ?? null,
      memo_id: `AA-${String(r.id).slice(0, 8).toUpperCase()}`,
      amount_usd: Number(r.optimized_acquisition_premium ?? 0),
      wire_instructed_at: String(r.wire_instructed_at ?? new Date().toISOString()),
      expires_at: r.m2m_expires_at ?? null,
      rail: "BlueVine Fedwire / Stripe ACH",
    }));
  });
