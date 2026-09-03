// Velocity drain circuit breaker ("bank run" switch).
// Autonomous payouts must never blast more than a fixed share of actually
// cleared cash inside a short window. Runaway loops and compromised keys drain
// fast; legitimate settlement does not.

export const VELOCITY_HALT_KEY = "SYSTEM_ALARM_VELOCITY_DRAIN";
/** Max share of cleared cash dispatchable inside the window. */
export const VELOCITY_MAX_SHARE = 0.2;
/** Rolling window in minutes. */
export const VELOCITY_WINDOW_MIN = 5;

export type VelocityVerdict = {
  allowed: boolean;
  reason?: string;
  dispatched_usd: number;
  cleared_usd: number;
  cap_usd: number;
};

/** True while a velocity halt is active (cleared only by an admin). */
export async function velocityHalted(): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("system_config")
      .select("value")
      .eq("key", VELOCITY_HALT_KEY)
      .maybeSingle();
    const v = (data as { value?: { tripped_at?: string; cleared?: boolean } } | null)?.value;
    return Boolean(v?.tripped_at) && v?.cleared !== true;
  } catch {
    return false; // fail-forward
  }
}

async function tripVelocityHalt(v: VelocityVerdict): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("system_config").upsert(
      {
        key: VELOCITY_HALT_KEY,
        value: { tripped_at: new Date().toISOString(), ...v } as never,
      } as never,
      { onConflict: "key" } as never,
    );
    await supabaseAdmin.from("system_config").upsert(
      { key: "autonomous_payouts_enabled", value: false as never } as never,
      { onConflict: "key" } as never,
    );
    await supabaseAdmin.from("system_alerts").insert({
      kind: VELOCITY_HALT_KEY,
      severity: "critical",
      message: `Velocity drain halt: $${v.dispatched_usd} dispatched in ${VELOCITY_WINDOW_MIN}m vs cap $${v.cap_usd}. Autonomous payouts halted.`,
      metadata: v as never,
    } as never);
    const { notifyAdmin } = await import("@/lib/notify.server");
    await notifyAdmin(
      `🚨 SYSTEM_ALARM_VELOCITY_DRAIN — $${v.dispatched_usd} dispatched in ${VELOCITY_WINDOW_MIN} minutes. Autonomous payouts halted.`,
      true,
    );
  } catch (e) {
    console.error("[velocity] halt write failed", e);
  }
}

/** Admin action: clears the velocity halt after review. */
export async function clearVelocityHalt(actor = "admin"): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("system_config").upsert(
    {
      key: VELOCITY_HALT_KEY,
      value: { cleared: true, cleared_at: new Date().toISOString(), cleared_by: actor } as never,
    } as never,
    { onConflict: "key" } as never,
  );
}

/**
 * Check whether dispatching `nextUsd` would breach the velocity cap.
 * Trips the halt (and disables autonomous payouts) when breached.
 */
export async function checkVelocity(nextUsd: number): Promise<VelocityVerdict> {
  const base: VelocityVerdict = {
    allowed: true,
    dispatched_usd: 0,
    cleared_usd: 0,
    cap_usd: 0,
  };
  try {
    if (await velocityHalted()) return { ...base, allowed: false, reason: "already_halted" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const windowStart = new Date(Date.now() - VELOCITY_WINDOW_MIN * 60_000).toISOString();

    // Total cleared cash (ledger truth).
    const { data: clearedRows } = await supabaseAdmin
      .from("system_audit_log")
      .select("new_data")
      .eq("operation", "FUNDS_CLEARED")
      .limit(5000);
    let cleared = 0;
    for (const r of (clearedRows ?? []) as unknown as Array<{
      new_data: { amount_usd?: number } | null;
    }>) {
      cleared += Number(r.new_data?.amount_usd ?? 0);
    }

    // Dispatched inside the rolling window.
    const { data: sentRows } = await supabaseAdmin
      .from("system_audit_log")
      .select("new_data, changed_at")
      .in("operation", ["WIRE_DISPATCHED", "PAYOUT_EXECUTED"])
      .gte("changed_at", windowStart)
      .limit(2000);
    let dispatched = 0;
    for (const r of (sentRows ?? []) as unknown as Array<{
      new_data: { amount_usd?: number; amount?: number } | null;
    }>) {
      dispatched += Number(r.new_data?.amount_usd ?? r.new_data?.amount ?? 0);
    }

    const cap = Math.round(cleared * VELOCITY_MAX_SHARE * 100) / 100;
    const verdict: VelocityVerdict = {
      allowed: true,
      dispatched_usd: Math.round(dispatched * 100) / 100,
      cleared_usd: Math.round(cleared * 100) / 100,
      cap_usd: cap,
    };

    // No cleared cash yet => nothing to drain; let existing gates decide.
    if (cleared <= 0) return verdict;

    if (dispatched + Math.max(0, nextUsd) > cap) {
      const breached = { ...verdict, allowed: false, reason: "velocity_cap_breached" };
      await tripVelocityHalt(breached);
      return breached;
    }
    return verdict;
  } catch (e) {
    console.error("[velocity] check failed", e);
    return base; // fail-forward
  }
}
