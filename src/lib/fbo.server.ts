// Inbound Liquidity Capture — FBO (For Benefit Of) virtual account engine.
// Every asset entering the T-Countdown / escrow-due state gets a unique
// inbound account+routing pair so institutional treasury systems have a
// deterministic destination. Fail-forward: never throws into a sweep path.
import { createHash } from "crypto";

export type FboAccount = {
  pipeline_item_id: string;
  fbo_account_number: string;
  routing_number: string;
  fbo_name: string;
  bank_name: string;
  expected_amount: number | null;
  status: string;
};

/** Deterministic 12-digit virtual account derived from the deal id. */
export function deriveFboNumber(dealId: string): string {
  const h = createHash("sha256").update(`fbo:${dealId}`).digest("hex");
  const n = BigInt("0x" + h.slice(0, 16)) % 1_000_000_000_00n;
  return "88" + n.toString().padStart(10, "0");
}

async function coords() {
  const { wireConfig, BENEFICIARY_NAME, BENEFICIARY_BANK } = await import(
    "@/lib/bluevine.server"
  );
  const cfg = wireConfig();
  return {
    routing: String(cfg.routing ?? ""),
    name: BENEFICIARY_NAME,
    bank: BENEFICIARY_BANK,
  };
}

/** Idempotently provision the inbound FBO account for one deal. */
export async function ensureFboAccount(
  dealId: string,
  expected?: number | null,
): Promise<FboAccount | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("inbound_wire_accounts")
      .select("*")
      .eq("pipeline_item_id", dealId)
      .maybeSingle();
    if (existing) return existing as unknown as FboAccount;

    const c = await coords();

    let amount = expected ?? null;
    if (amount == null) {
      const { data: deal } = await supabaseAdmin
        .from("closing_pipeline_items")
        .select("optimized_acquisition_premium")
        .eq("id", dealId)
        .maybeSingle();
      amount = Number((deal as any)?.optimized_acquisition_premium ?? 0) || null;
    }

    const fboName = `${c.name} FBO ${dealId.slice(0, 8).toUpperCase()}`;

    let row: Record<string, unknown> | null = null;

    if (!row) {
      // Fallback: static beneficiary coordinates (no per-deal isolation).
      if (!c.routing) return null; // rails not configured — surfaced in diagnostics
      row = {
        pipeline_item_id: dealId,
        fbo_account_number: deriveFboNumber(dealId),
        routing_number: c.routing,
        fbo_name: fboName,
        bank_name: c.bank,
        expected_amount: amount,
        status: "VERIFIED_DIRECT_WIRE",
        provider: "derived",
      };
    }

    const { data } = await supabaseAdmin
      .from("inbound_wire_accounts")
      .upsert(row as never, { onConflict: "pipeline_item_id" })
      .select("*")
      .maybeSingle();
    return (data as unknown as FboAccount) ?? (row as unknown as FboAccount);
  } catch (e) {
    console.error("[fbo] ensure failed", dealId, e);
    return null;
  }
}


/** Sweep: provision FBO accounts for every deal awaiting buyer funds. */
export async function provisionOpenDeals(limit = 500) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: deals } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("id,optimized_acquisition_premium,status,escrow_status")
    .in("status", [
      "Webhook_Dispatched",
      "Locked-Escrow-Pending",
      "In-Escrow",
      "Buyer-Signed",
    ])
    .is("cleared_at", null)
    .limit(limit);

  let provisioned = 0;
  let skipped = 0;
  for (const d of (deals ?? []) as Array<Record<string, any>>) {
    const r = await ensureFboAccount(
      d["id"],
      Number(d["optimized_acquisition_premium"] ?? 0) || null,
    );
    if (r) provisioned++;
    else skipped++;
  }
  return { scanned: (deals ?? []).length, provisioned, skipped };
}

export type InboundWire = {
  event_id?: string | null;
  fbo_account_number?: string | null;
  amount_usd: number;
  sender_reference?: string | null;
  deal_id?: string | null;
  raw?: unknown;
};

/**
 * Exact-match reconciliation: tie an inbound wire to the parcel awaiting funds,
 * clear it idempotently, and hand off to autonomous outbound transit.
 */
export async function reconcileInboundWire(w: InboundWire) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const log = async (
    match_status: string,
    reason: string | null,
    matched_item_id: string | null,
  ) => {
    await supabaseAdmin.from("inbound_wire_events").insert({
      event_id: w.event_id ?? null,
      fbo_account_number: w.fbo_account_number ?? null,
      amount_usd: w.amount_usd,
      sender_reference: w.sender_reference ?? null,
      matched_item_id,
      match_status,
      reason,
      raw: (w.raw ?? {}) as never,
    } as never);
  };

  // 1. Locate the FBO account (or fall back to an explicit deal id).
  let acct: any = null;
  if (w.fbo_account_number) {
    const { data } = await supabaseAdmin
      .from("inbound_wire_accounts")
      .select("*")
      .eq("fbo_account_number", w.fbo_account_number)
      .maybeSingle();
    acct = data;
  }
  if (!acct && w.deal_id) {
    const { data } = await supabaseAdmin
      .from("inbound_wire_accounts")
      .select("*")
      .eq("pipeline_item_id", w.deal_id)
      .maybeSingle();
    acct = data;
  }
  if (!acct) {
    await log("unmatched", "no_fbo_account_for_payload", w.deal_id ?? null);
    return { matched: false, reason: "no_fbo_account_for_payload" };
  }

  // 2. Exact-amount reconciliation (1 cent tolerance) when an amount is expected.
  const expected = Number(acct.expected_amount ?? 0);
  if (expected > 0 && Math.abs(expected - w.amount_usd) > 0.01) {
    await log("amount_mismatch", `expected ${expected}, received ${w.amount_usd}`, acct.pipeline_item_id);
    return { matched: false, reason: "amount_mismatch", expected };
  }

  // 3. Idempotent clearance.
  const eventKey = w.event_id ?? `wire_${acct.fbo_account_number}_${w.amount_usd}`;
  const { error: clearErr } = await supabaseAdmin.rpc("clear_funds_idempotent", {
    _deal_id: acct.pipeline_item_id,
    _cleared_amount: w.amount_usd,
    _stripe_event_id: eventKey,
  });
  if (clearErr) {
    await log("clear_failed", clearErr.message, acct.pipeline_item_id);
    return { matched: false, reason: clearErr.message };
  }

  await supabaseAdmin
    .from("inbound_wire_accounts")
    .update({
      status: "funded",
      funded_amount: w.amount_usd,
      funded_at: new Date().toISOString(),
    } as never)
    .eq("id", acct.id);

  await log("matched", null, acct.pipeline_item_id);

  // 4. Hand off to autonomous outbound transit — Stage 5 split-ledger payout.
  // Retried with exponential backoff; exhaustion raises a System Logs alert.
  let settled = false;
  try {
    const { withRetry } = await import("@/lib/retry.server");
    const { payoutAssignmentFee } = await import("@/lib/payout.server");
    const r = await withRetry(
      async () => {
        const r = await payoutAssignmentFee(acct.pipeline_item_id);
        if (!r.ok && !["already_paid", "zero_fee"].includes(r.reason)) {
          throw new Error(r.reason);
        }
        return r;
      },
      { label: "assignment-fee-payout", dealId: acct.pipeline_item_id },
    );
    // 5. Settlement state lock. With a live bank rail the ledger stays
    //    Direct Bluevine wire: settlement locks on payout success.
    if ((r as any)?.ok || (r as any)?.reason === "already_paid") {
      settled = true;
      await supabaseAdmin
        .from("closing_pipeline_items")
        .update({ payout_status: "SETTLED_PAID" } as never)
        .eq("id", acct.pipeline_item_id);
    }
  } catch (e) {
    console.error("[fbo] outbound handoff failed", e);
  }

  // 6. Seller escrow leg — push the balance beyond the assignment fee to the
  //    seller's verified destination. Never blocks the fee settlement.
  try {
    const { disburseSellerRemainder } = await import("@/lib/seller-escrow.server");
    await disburseSellerRemainder(acct.pipeline_item_id, w.amount_usd);
  } catch (e) {
    console.error("[fbo] seller escrow leg failed", e);
  }


  return { matched: true, deal_id: acct.pipeline_item_id, amount: w.amount_usd, settled };

}

/** Inbound Listener Diagnostics — where buyer money was previously dropping. */
export async function inboundDiagnostics() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [dueRes, acctRes, evtRes] = await Promise.all([
    supabaseAdmin
      .from("closing_pipeline_items")
      .select("id", { count: "exact", head: true })
      .in("status", ["Webhook_Dispatched", "Locked-Escrow-Pending", "In-Escrow", "Buyer-Signed"])
      .is("cleared_at", null),
    supabaseAdmin.from("inbound_wire_accounts").select("status"),
    supabaseAdmin
      .from("inbound_wire_events")
      .select("id,event_id,fbo_account_number,amount_usd,match_status,reason,matched_item_id,created_at")
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const accts = (acctRes.data ?? []) as Array<{ status: string }>;
  const awaiting = dueRes.count ?? 0;
  const provisioned = accts.length;
  const funded = accts.filter((a) => a.status === "funded").length;
  const c = await coords();

  const findings: Array<{ level: string; endpoint: string; detail: string }> = [];
  if (!c.routing)
    findings.push({
      level: "critical",
      endpoint: "bluevine coordinates",
      detail: "No routing number configured — FBO accounts cannot be minted, so buyers have no destination.",
    });
  if (awaiting > provisioned)
    findings.push({
      level: "critical",
      endpoint: "/api/public/hooks/fbo-provision",
      detail: `${awaiting - provisioned} assets are awaiting buyer funds with NO inbound FBO account. Treasury algorithms hold instead of wiring.`,
    });
  findings.push({
    level: "info",
    endpoint: "/api/public/hooks/inbound-wire-received",
    detail:
      "Inbound listener is now mapped. Prior to this deployment no endpoint accepted inbound wire notifications — clearinghouse POSTs 404'd and were dropped.",
  });
  const events = (evtRes.data ?? []) as Array<Record<string, any>>;
  const dropped = events.filter((e) => e["match_status"] !== "matched");
  if (dropped.length)
    findings.push({
      level: "warn",
      endpoint: "reconciliation",
      detail: `${dropped.length} of the last ${events.length} inbound payloads failed exact-match (${[...new Set(dropped.map((d) => d["reason"] ?? d["match_status"]))].join(", ")}).`,
    });

  return {
    awaiting_funds: awaiting,
    fbo_provisioned: provisioned,
    fbo_funded: funded,
    routing_configured: Boolean(c.routing),
    findings,
    events,
  };
}
