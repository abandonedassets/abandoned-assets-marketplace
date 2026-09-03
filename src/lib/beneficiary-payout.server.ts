// Split-ledger disbursement: dispatches each beneficiary leg over the
// Bluevine ACH / Fedwire rail. Fail-forward — never throws into a sweep.

import { splitProceeds, type BeneficiaryKey, type RoutingInput } from "@/lib/beneficiary-routing";

export type BeneficiaryAccount = {
  key: BeneficiaryKey;
  name: string;
  configured: boolean;
  account_last4: string | null;
  routing_prefix: string | null;
};

const ENV_PREFIX: Record<BeneficiaryKey, string> = {
  PRIMARY: "BLUEVINE",
  JACQUITA: "JAQUITA",
  DAUGHTER: "JAZMIN",
};

const DEFAULT_NAME: Record<BeneficiaryKey, string> = {
  PRIMARY: "ReelEdge Entertainment LLC",
  JACQUITA: "Jaquita Beneficiary Account",
  DAUGHTER: "Jazmin Beneficiary Account",
};

export function beneficiaryAccount(key: BeneficiaryKey): BeneficiaryAccount {
  const p = ENV_PREFIX[key];
  const account = process.env[`${p}_ACCOUNT_NUMBER`] ?? null;
  const routing = process.env[`${p}_ROUTING_NUMBER`] ?? null;
  return {
    key,
    name: process.env[`${p}_BENEFICIARY_NAME`] || DEFAULT_NAME[key],
    configured: Boolean(account && routing),
    account_last4: account ? String(account).slice(-4) : null,
    routing_prefix: routing ? String(routing).slice(0, 3) : null,
  };
}

export function beneficiaryAccounts(): BeneficiaryAccount[] {
  return (["PRIMARY", "JACQUITA", "DAUGHTER"] as BeneficiaryKey[]).map(beneficiaryAccount);
}

export type SplitLeg = {
  key: BeneficiaryKey;
  beneficiary: string;
  amount_usd: number;
  reason: string;
  ok: boolean;
  transfer_id?: string;
  error?: string;
};

/**
 * Centralized intake model:
 * 100% of net proceeds are wired to the PRIMARY account on a single leg.
 * The beneficiary matrix still runs, but the resulting splits are recorded
 * as internal credit balances in `internal_beneficiary_allocations` instead
 * of being dispatched externally. No external beneficiary coordinates needed.
 */
export async function dispatchSplitLedger(input: {
  dealId: string;
  netUsd: number;
  asset: RoutingInput;
  dryRun?: boolean;
}): Promise<{ ok: boolean; legs: SplitLeg[]; total_usd: number }> {
  const allocations = splitProceeds(input.asset, input.netUsd);
  const primary = beneficiaryAccount("PRIMARY");
  const net = Math.round((Number(input.netUsd) || 0) * 100) / 100;

  if (input.dryRun) {
    return {
      ok: primary.configured,
      legs: [
        {
          key: "PRIMARY",
          beneficiary: primary.name,
          amount_usd: net,
          reason: `Centralized intake · internal allocations: ${allocations
            .map((a) => `${a.key} $${a.amount_usd.toLocaleString("en-US")}`)
            .join(" · ")}`,
          ok: primary.configured,
          ...(primary.configured ? {} : { error: "primary_coordinates_missing" }),
        },
      ],
      total_usd: net,
    };
  }

  const { assertLiveRails } = await import("@/lib/live-rails.server");
  assertLiveRails();

  if (!primary.configured) {
    throw new Error(
      "FATAL: primary intake account missing (BLUEVINE_ROUTING_NUMBER / BLUEVINE_ACCOUNT_NUMBER). No funds dispatched.",
    );
  }

  const { issueWireCredit } = await import("@/lib/bluevine-rails.server");

  // --- Multi-recipient split: configured secondary recipients get their own
  // ACH/Fedwire leg to their routing/account numbers; the rest goes PRIMARY.
  const { loadRecipientProfiles } = await import("@/lib/recipient-profiles.server");
  const profiles = await loadRecipientProfiles();

  // Deterministic mandate routing drives the legs (Muncie / timber / valuation /
  // parity). Recipient profiles only supply bank coordinates + display names.
  const recipientSplits = allocations
    .filter((a) => a.key !== "PRIMARY" && a.amount_usd > 0)
    .map((a) => {
      const prof = profiles.find((p) => p.recipient_key === a.key);
      return {
        recipient_key: a.key,
        display_name: prof?.display_name ?? a.label,
        amount_usd: a.amount_usd,
        basis: a.code as string,
        configured: Boolean(prof?.configured),
      };
    });
  const primary_remainder_usd =
    Math.round((net - recipientSplits.reduce((s, l) => s + l.amount_usd, 0)) * 100) / 100;

  const dispatched: SplitLeg[] = [];
  let primaryAmount = primary_remainder_usd;

  for (const s of recipientSplits) {
    if (!s.configured) {
      // No coordinates yet — keep the money in primary and accrue internally.
      primaryAmount = Math.round((primaryAmount + s.amount_usd) * 100) / 100;
      dispatched.push({
        key: s.recipient_key as BeneficiaryKey,
        beneficiary: s.display_name,
        amount_usd: s.amount_usd,
        reason: `Split ${s.basis} · coordinates missing — accrued internally`,
        ok: false,
        error: "recipient_coordinates_missing",
      });
      continue;
    }
    const r = await issueWireCredit({
      dealId: input.dealId,
      amountUsd: s.amount_usd,
      memo: `Split payout (${s.recipient_key}) — deal ${input.dealId.slice(0, 8)}`,
      beneficiaryName: s.display_name,
      idempotencyKey: `split_${s.recipient_key}_${input.dealId}`,
    });
    if (r.ok) {
      dispatched.push({
        key: s.recipient_key as BeneficiaryKey,
        beneficiary: s.display_name,
        amount_usd: s.amount_usd,
        reason: `Split ${s.basis} distribution`,
        ok: true,
        transfer_id: r.id,
      });
    } else {
      primaryAmount = Math.round((primaryAmount + s.amount_usd) * 100) / 100;
      dispatched.push({
        key: s.recipient_key as BeneficiaryKey,
        beneficiary: s.display_name,
        amount_usd: s.amount_usd,
        reason: `Split ${s.basis} distribution`,
        ok: false,
        error: r.error,
      });
    }
  }

  const rail = await issueWireCredit({
    dealId: input.dealId,
    amountUsd: primaryAmount,
    memo: `Settlement intake (PRIMARY) — deal ${input.dealId.slice(0, 8)}`,
    beneficiaryName: primary.name,
    idempotencyKey: `intake_PRIMARY_${input.dealId}`,
  });

  const leg: SplitLeg = rail.ok
    ? {
        key: "PRIMARY",
        beneficiary: primary.name,
        amount_usd: primaryAmount,
        reason: "Primary intake (net of recipient splits)",
        ok: true,
        transfer_id: rail.id,
      }
    : {
        key: "PRIMARY",
        beneficiary: primary.name,
        amount_usd: primaryAmount,
        reason: "Primary intake (net of recipient splits)",
        ok: false,
        error: rail.error,
      };

  if (!leg.ok) {
    throw new Error(`FATAL: primary intake dispatch failed (${leg.error}). Deal not marked paid.`);
  }

  // Internal sub-ledger — credit balances owed out of the primary tranche.
  await recordInternalAllocations({
    dealId: input.dealId,
    allocations,
    transferId: leg.transfer_id ?? null,
  });

  // Record externally-wired recipient legs on the sub-ledger as settled.
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = dispatched
      .filter((l) => l.ok)
      .map((l) => ({
        pipeline_item_id: input.dealId,
        beneficiary_key: l.key,
        beneficiary_label: l.beneficiary,
        amount_usd: l.amount_usd,
        pct: net > 0 ? l.amount_usd / net : 0,
        reason: l.reason,
        status: "settled",
        settled_at: new Date().toISOString(),
        external_transfer_id: l.transfer_id ?? null,
        dispatch_rail: "bluevine",
      }));
    if (rows.length) {
      await supabaseAdmin
        .from("internal_beneficiary_allocations" as any)
        .upsert(rows as any, { onConflict: "pipeline_item_id,beneficiary_key" });
    }
  } catch (e) {
    console.error("[beneficiary] split leg ledger write failed", e);
  }

  const allLegs = [...dispatched, leg];

  // Immutable audit trail of the routing decision for tax reconciliation.
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { routingDecisionCode } = await import("@/lib/beneficiary-routing");
    await supabaseAdmin.from("outbound_alert_log" as any).insert({
      pipeline_item_id: input.dealId,
      channel: "routing_decision",
      target: routingDecisionCode(input.asset),
      status: "recorded",
      payload: { net_usd: net, allocations, legs: allLegs } as never,
    } as never);
  } catch (e) {
    console.error("[beneficiary] routing decision log failed", e);
  }

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("system_audit_logs").insert({
      pipeline_item_id: input.dealId,
      event_type: "SPLIT_PAYOUT_DISPATCH",
      reason: allLegs
        .map((l) => `${l.key} $${l.amount_usd.toLocaleString("en-US")} ${l.ok ? "OK" : "FAIL"}`)
        .join(" · "),
      payload: { legs: allLegs, allocations, net_usd: net } as never,
    } as never);
  } catch {
    /* telemetry optional */
  }

  return { ok: true, legs: allLegs, total_usd: net };
}

/** Write (idempotently) the internal beneficiary credit balances for a deal. */
export async function recordInternalAllocations(input: {
  dealId: string;
  allocations: ReturnType<typeof splitProceeds>;
  transferId?: string | null;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = input.allocations
      .filter((a) => a.amount_usd > 0)
      .map((a) => ({
        pipeline_item_id: input.dealId,
        beneficiary_key: a.key,
        beneficiary_label: a.label,
        amount_usd: a.amount_usd,
        pct: a.pct,
        reason: a.reason,
        status: "accrued",
        external_transfer_id: input.transferId ?? null,
      }));
    if (!rows.length) return;
    await supabaseAdmin
      .from("internal_beneficiary_allocations" as any)
      .upsert(rows as any, { onConflict: "pipeline_item_id,beneficiary_key" });
  } catch (e) {
    console.error("[beneficiary] internal allocation write failed", e);
  }
}
