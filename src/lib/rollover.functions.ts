import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Shared selector for the rollover-queue state. The Rollover Queue and the
 * Tomorrow Pipeline widget MUST read through this constant so they cannot
 * drift apart (filter mismatch = math mismatch).
 */
export const QUEUED_FOR_TOMORROW_STATUS = "Queued-For-Tomorrow" as const;

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

export type RolloverStatus = {
  daily_cap_usd: number;
  cleared_today_usd: number;
  remaining_today_usd: number;
  tomorrow_count: number;
  tomorrow_total_usd: number;
  system_hold_count: number;
};

export const getRolloverStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RolloverStatus> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: cfg }, { data: cleared }, { data: tomorrow }, { data: held }] =
      await Promise.all([
        supabaseAdmin.from("system_config").select("value").eq("key", "daily_payout_cap_usd").maybeSingle(),
        supabaseAdmin.rpc("cleared_today_usd" as any),
        supabaseAdmin
          .from("closing_pipeline_items")
          .select("optimized_acquisition_premium")
          .eq("status", QUEUED_FOR_TOMORROW_STATUS),
        supabaseAdmin
          .from("closing_pipeline_items")
          .select("id", { count: "exact", head: true })
          .eq("status", "System-Hold"),
      ]);

    const cap = Number(cfg?.value ?? 5000);
    const clearedToday = Number(cleared ?? 0);
    const tomorrowRows = (tomorrow ?? []) as Array<{ optimized_acquisition_premium: number | null }>;
    const tomorrowTotal = tomorrowRows.reduce(
      (s, r) => s + Number(r.optimized_acquisition_premium ?? 0),
      0,
    );

    return {
      daily_cap_usd: cap,
      cleared_today_usd: clearedToday,
      remaining_today_usd: Math.max(cap - clearedToday, 0),
      tomorrow_count: tomorrowRows.length,
      tomorrow_total_usd: tomorrowTotal,
      system_hold_count: (held as any)?.length ?? 0,
    };
  });

export type ClearedAsset = {
  id: string;
  zip: string | null;
  address: string | null;
  cleared_at: string;
  cleared_amount: number;
  bank_date: string; // YYYY-MM-DD, Bluevine standard rolling 2-day estimate
  days_to_bank: number;
};

/**
 * Bluevine settlement is a rolling ~2 business days from debit clearance.
 * Without per-account payout overrides available, we estimate +2 calendar days
 * and skip weekends. This is shown as an estimate, not a guarantee.
 */
function estimateBankDate(clearedAt: Date): { date: Date; days: number } {
  const d = new Date(clearedAt);
  let added = 0;
  while (added < 2) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setUTCHours(0, 0, 0, 0);
  const days = Math.max(
    0,
    Math.round((target.getTime() - today.getTime()) / 86_400_000),
  );
  return { date: d, days };
}

export const getRecentCleared = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClearedAsset[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id, zip, address, cleared_at, cleared_amount, optimized_acquisition_premium")
      .eq("status", "Funds-Cleared")
      .not("cleared_at", "is", null)
      .order("cleared_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => {
      const { date, days } = estimateBankDate(new Date(r.cleared_at));
      return {
        id: r.id,
        zip: r.zip,
        address: r.address,
        cleared_at: r.cleared_at,
        cleared_amount: Number(r.cleared_amount ?? r.optimized_acquisition_premium ?? 0),
        bank_date: date.toISOString().slice(0, 10),
        days_to_bank: days,
      };
    });
  });
