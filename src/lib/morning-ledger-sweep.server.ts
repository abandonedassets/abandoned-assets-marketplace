// Morning ledger sweep: push the prior 24h of cleared database fees to the
// linked Bluevine business checking account via a single Stripe payout.
// Idempotent by UTC date; fail-forward; never blocks other paths.

import { appendLedger } from "./event-ledger.server";
import { reconciliationHalted, runLedgerReconciliation } from "./ledger-reconcile.server";
import { fmtUsd, notifyAdmin } from "./notify.server";
import { stripeBalance, stripeInstantPayout } from "./stripe-payout.server";

const MIN_SWEEP_USD = Number(process.env["MORNING_SWEEP_MIN_USD"] ?? 1);
const RESERVE_USD = Number(process.env["MORNING_SWEEP_RESERVE_USD"] ?? 0);
const SWEEP_METHOD = (process.env["MORNING_SWEEP_METHOD"] ?? "standard") as "instant" | "standard";

export type MorningSweepReport =
  | {
      ok: true;
      date: string;
      requested_usd: number;
      swept_usd: number;
      payout_id: string;
      method: string;
      status: string;
    }
  | { ok: false; date: string; reason: string; detail?: string };

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function morningLedgerSweep(windowHours = 24): Promise<MorningSweepReport> {
  const date = utcDate();
  const base: MorningSweepReport = { ok: false, date, reason: "unknown" };

  if (await reconciliationHalted()) {
    return { ...base, reason: "reconciliation_halted" };
  }

  // 1. Database-side truth: cleared fees in the window.
  const recon = await runLedgerReconciliation(windowHours);
  if (!recon.ok) {
    return { ...base, reason: "recon_failed", detail: recon.reason ?? "unknown" };
  }
  if (recon.mismatch) {
    const msg = `Morning sweep aborted: Stripe ${fmtUsd(recon.stripe_settled_usd)} vs ledger ${fmtUsd(recon.ledger_cleared_usd)} (delta ${fmtUsd(recon.delta_usd)})`;
    await notifyAdmin(msg, true);
    return { ...base, reason: "reconciliation_mismatch", detail: msg };
  }

  const target = Math.max(0, recon.ledger_cleared_usd - RESERVE_USD);
  if (target < MIN_SWEEP_USD) {
    return { ...base, reason: "below_minimum", detail: `target ${fmtUsd(target)}` };
  }

  // 2. Confirm Stripe actually has the money.
  const balance = await stripeBalance();
  if (!balance.configured) {
    return { ...base, reason: "stripe_not_configured" };
  }
  if (balance.error) {
    return { ...base, reason: "stripe_balance_error", detail: balance.error };
  }

  const available = Math.max(0, balance.available_usd - RESERVE_USD);
  if (available < target) {
    const msg = `Morning sweep skipped: ledger ${fmtUsd(target)} > available ${fmtUsd(available)}`;
    await notifyAdmin(msg, false);
    return { ...base, reason: "insufficient_stripe_balance", detail: msg };
  }

  // 3. Single daily payout to the linked bank account (Bluevine).
  const payout = await stripeInstantPayout({
    amountUsd: target,
    description: `Morning ledger sweep ${date}`,
    dealId: `morning-sweep-${date}`,
    idempotencyKey: `morning_sweep_${date}`,
    method: SWEEP_METHOD,
  });

  if (!payout.ok) {
    const msg = `Morning sweep payout failed: ${payout.error}${payout.detail ? ` — ${payout.detail}` : ""}`;
    await notifyAdmin(msg, true);
    await appendLedger({
      entity: "morning_ledger_sweep",
      operation: "MORNING_SWEEP_FAILED",
      actor: "morning_sweep_worker",
      after: { date, requested_usd: target, error: payout.error, detail: payout.detail },
    });
    return { ...base, reason: "payout_failed", detail: payout.error };
  }

  await appendLedger({
    entity: "morning_ledger_sweep",
    operation: "MORNING_SWEEP_DISPATCHED",
    actor: "morning_sweep_worker",
    after: {
      date,
      requested_usd: target,
      swept_usd: payout.amount_usd,
      payout_id: payout.payout_id,
      method: payout.method,
      status: payout.status,
    },
  });

  return {
    ok: true,
    date,
    requested_usd: target,
    swept_usd: payout.amount_usd,
    payout_id: payout.payout_id,
    method: payout.method,
    status: payout.status,
  };
}
