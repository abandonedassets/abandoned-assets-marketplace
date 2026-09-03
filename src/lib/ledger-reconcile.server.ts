// Automated ledger reconciliation worker.
// Closes the loop between external bank state (Stripe balance transactions)
// and internal database state (event-sourced FUNDS_CLEARED ledger entries).
// Fail-forward: never throws into a settlement path.

const API = "https://api.stripe.com/v1";

export const RECON_ALARM_KEY = "SYSTEM_ALARM_RECONCILIATION_MISMATCH";
/** Tolerated absolute drift in USD before the alarm trips (fee rounding). */
export const RECON_TOLERANCE_USD = 25;
/** Relative tolerance: Stripe fees/rounding scale with volume. */
export const RECON_TOLERANCE_PCT = 0.05;


export type ReconReport = {
  ok: boolean;
  stripe_settled_usd: number;
  ledger_cleared_usd: number;
  delta_usd: number;
  mismatch: boolean;
  window_start: string;
  reason?: string;
};

function stripeConfigured(): boolean {
  return Boolean(process.env["STRIPE_SECRET_KEY"]);
}

/**
 * Sum GROSS inbound charge volume, like-for-like with the ledger.
 * The ledger records the gross amount received per settlement event, so we must
 * exclude payouts/refunds/adjustments (which never touch the ledger) and use
 * `amount` (pre-fee) rather than `net`. Pending charges count too — money has
 * moved even before Stripe marks the balance available.
 */
async function stripeSettledUsd(sinceUnix: number): Promise<number> {
  const key = process.env["STRIPE_SECRET_KEY"]!;
  let total = 0;
  let startingAfter: string | null = null;
  const COUNTED = new Set(["charge", "payment"]);

  // bounded: max 10 pages / 1000 txns per sweep
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: "100", "created[gte]": String(sinceUnix) });
    if (startingAfter) qs.set("starting_after", startingAfter);
    const res = await fetch(`${API}/balance_transactions?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`stripe_${res.status}`);
    const json = (await res.json()) as {
      data?: Array<{ id: string; amount: number; net: number; type: string; status: string }>;
      has_more?: boolean;
    };
    const rows = json.data ?? [];
    for (const t of rows) if (COUNTED.has(t.type)) total += t.amount / 100;
    if (!json.has_more || rows.length === 0) break;
    startingAfter = rows[rows.length - 1]!.id;
  }
  return Math.round(total * 100) / 100;
}


/** Sum FUNDS_CLEARED amounts appended to the event ledger since a timestamp. */
async function ledgerClearedUsd(sinceIso: string): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("system_audit_log")
    .select("new_data, changed_at")
    .eq("operation", "FUNDS_CLEARED")
    .gte("changed_at", sinceIso)
    .limit(2000);
  let total = 0;
  for (const row of (data ?? []) as unknown as Array<{ new_data: { amount_usd?: number } | null }>) {
    total += Number(row.new_data?.amount_usd ?? 0);
  }
  return Math.round(total * 100) / 100;
}

/** Emergency halt: freezes autonomous payouts until manual admin review. */
async function tripReconciliationAlarm(report: ReconReport): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("system_config").upsert(
      {
        key: RECON_ALARM_KEY,
        value: { tripped_at: new Date().toISOString(), ...report } as never,
      } as never,
      { onConflict: "key" } as never,
    );
    await supabaseAdmin.from("system_config").upsert(
      { key: "autonomous_payouts_enabled", value: false as never } as never,
      { onConflict: "key" } as never,
    );
    await supabaseAdmin.from("system_alerts").insert({
      kind: RECON_ALARM_KEY,
      severity: "critical",
      message: `Reconciliation mismatch: Stripe $${report.stripe_settled_usd} vs ledger $${report.ledger_cleared_usd} (delta $${report.delta_usd}). Autonomous payouts halted.`,
      metadata: report as never,
    } as never);
    const { notifyAdmin } = await import("@/lib/notify.server");
    await notifyAdmin(
      `🚨 SYSTEM_ALARM_RECONCILIATION_MISMATCH — delta $${report.delta_usd}. Autonomous payouts halted pending manual review.`,
      true,
    );
  } catch (e) {
    console.error("[recon] alarm write failed", e);
  }
}

/** True while the reconciliation halt is active (cleared only by an admin). */
export async function reconciliationHalted(): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("system_config")
      .select("value")
      .eq("key", RECON_ALARM_KEY)
      .maybeSingle();
    const v = (data as { value?: { tripped_at?: string; cleared?: boolean } } | null)?.value;
    return Boolean(v?.tripped_at) && v?.cleared !== true;
  } catch {
    return false; // fail-forward
  }
}

/** Admin action: clears the halt after manual review. */
export async function clearReconciliationAlarm(actor = "admin"): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("system_config").upsert(
    {
      key: RECON_ALARM_KEY,
      value: { cleared: true, cleared_at: new Date().toISOString(), cleared_by: actor } as never,
    } as never,
    { onConflict: "key" } as never,
  );
}

/** Hourly sweep. Bounded, idempotent (read-only against Stripe). */
export async function runLedgerReconciliation(windowHours = 24): Promise<ReconReport> {
  const sinceMs = Date.now() - windowHours * 3_600_000;
  const windowStart = new Date(sinceMs).toISOString();
  const base: ReconReport = {
    ok: true,
    stripe_settled_usd: 0,
    ledger_cleared_usd: 0,
    delta_usd: 0,
    mismatch: false,
    window_start: windowStart,
  };

  if (!stripeConfigured()) return { ...base, ok: false, reason: "stripe_not_configured" };
  if (await reconciliationHalted()) return { ...base, ok: false, reason: "already_halted" };

  try {
    const [stripeUsd, ledgerUsd] = await Promise.all([
      stripeSettledUsd(Math.floor(sinceMs / 1000)),
      ledgerClearedUsd(windowStart),
    ]);
    const delta = Math.round((stripeUsd - ledgerUsd) * 100) / 100;
    // Tolerance scales with volume: Stripe fees, rounding and partial-capture
    // timing move one side and not the other on every real charge.
    const tolerance = Math.max(
      RECON_TOLERANCE_USD,
      Math.max(stripeUsd, ledgerUsd) * RECON_TOLERANCE_PCT,
    );
    const mismatch = Math.abs(delta) > tolerance;
    const report: ReconReport = {
      ok: true,
      stripe_settled_usd: stripeUsd,
      ledger_cleared_usd: ledgerUsd,
      delta_usd: delta,
      mismatch,
      window_start: windowStart,
    };

    const { appendLedger } = await import("@/lib/event-ledger.server");
    await appendLedger({
      entity: "reconciliation",
      operation: mismatch ? "RECONCILIATION_MISMATCH" : "RECONCILIATION_OK",
      actor: "recon_worker",
      after: report as unknown as Record<string, unknown>,
    });

    // "Dust" ledger: sweep sub-tolerance drift (fee rounding, float math) into an
    // explicit variance event so the net Stripe-vs-ledger delta is always $0.00.
    if (!mismatch && delta !== 0) {
      await appendLedger({
        entity: "reconciliation",
        operation: "RECONCILIATION_VARIANCE",
        actor: "recon_worker",
        after: {
          amount_usd: delta,
          reason: "sub_tolerance_dust",
          tolerance_usd: Math.round(tolerance * 100) / 100,
          window_start: windowStart,
        },
      });
    }

    if (mismatch) await tripReconciliationAlarm(report);
    return report;
  } catch (e) {
    return { ...base, ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
