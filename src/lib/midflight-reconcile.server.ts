// Mid-flight reconciliation sweep.
// Scans dispatched / wire-instructions-sent contracts, verifies whether cash
// actually landed at Stripe, and drives the terminal state transition +
// ledger writes. Fail-forward: one bad row never halts the sweep.

const API = "https://api.stripe.com/v1";

function key() {
  return process.env["STRIPE_RESTRICTED_KEY"] || process.env["STRIPE_SECRET_KEY"] || "";
}

async function stripeGet(path: string) {
  const k = key();
  if (!k) return { ok: false, json: {} as any };
  try {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${k}` } });
    return { ok: res.ok, json: (await res.json()) as any };
  } catch {
    return { ok: false, json: {} as any };
  }
}

/** Look for a settled Stripe object tied to this deal. */
async function findClearingEvent(dealId: string): Promise<{ ref: string; amount: number } | null> {
  const q = encodeURIComponent(`metadata['deal_id']:'${dealId}' AND status:'succeeded'`);
  for (const obj of ["payment_intents", "charges"]) {
    const r = await stripeGet(`/${obj}/search?query=${q}&limit=1`);
    const hit = r.json?.data?.[0];
    if (hit?.id) {
      const cents = Number(hit.amount_received ?? hit.amount ?? 0);
      return { ref: String(hit.id), amount: Math.abs(cents) / 100 };
    }
  }
  return null;
}

export type MidflightReport = {
  ok: boolean;
  scanned: number;
  cleared: number;
  pending: number;
  errors: string[];
  deals: Array<{ id: string; action: string; amount_usd?: number; ref?: string }>;
};

/** Write the settlement ledger + delivery tape rows for a cleared deal. */
export async function writeSettlementLedger(
  deal: Record<string, any>,
  amount: number,
  ref: string,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const dealId = String(deal["id"]);
  try {
    const { data: existing } = await supabaseAdmin
      .from("shadow_escrow_ledger")
      .select("id")
      .eq("pipeline_item_id", dealId)
      .limit(1);
    if (!existing?.length && deal["user_id"]) {
      await supabaseAdmin.from("shadow_escrow_ledger").insert({
        pipeline_item_id: dealId,
        user_id: deal["user_id"],
        total_assignment_fee: amount,
        amount_secured: amount,
        amount_released: 0,
        liquidity_state: "CLEARED",
      } as never);
    }
  } catch (e) {
    console.error("[midflight] shadow ledger write failed", e);
  }
  try {
    await supabaseAdmin.from("offer_delivery_logs").insert({
      pipeline_item_id: dealId,
      status: "EXECUTED",
      meta: { settlement_reference: ref, cleared_amount_usd: amount, source: "midflight_reconcile" },
    } as never);
  } catch (e) {
    console.error("[midflight] delivery log write failed", e);
  }
}

export async function runMidflightReconcile(limit = 200): Promise<MidflightReport> {
  const out: MidflightReport = { ok: true, scanned: 0, cleared: 0, pending: 0, errors: [], deals: [] };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("*")
    .or("status.eq.Webhook_Dispatched,escrow_status.eq.WIRE_INSTRUCTIONS_SENT")
    .is("cleared_at", null)
    .limit(limit);
  if (error) return { ...out, ok: false, errors: [error.message] };

  const rows = (data ?? []) as Record<string, any>[];
  out.scanned = rows.length;

  for (const row of rows) {
    const dealId = String(row["id"]);
    try {
      const hit = await findClearingEvent(dealId);
      if (!hit) {
        out.pending++;
        out.deals.push({ id: dealId, action: "awaiting_funds" });
        continue;
      }

      const fee = Number(row["assignment_fee"] ?? 0) || hit.amount;
      await supabaseAdmin
        .from("closing_pipeline_items")
        .update({
          status: "Funds-Cleared",
          escrow_status: "CLEARED",
          payout_status: "FEE_CLEARED",
          cleared_amount: fee,
          cleared_at: new Date().toISOString(),
          settlement_reference: hit.ref,
        } as never)
        .eq("id", dealId);

      await writeSettlementLedger(row, fee, hit.ref);

      try {
        const { clearFeeAndSplit } = await import("@/lib/fee-clearing.server");
        await clearFeeAndSplit(dealId, fee, hit.ref);
      } catch (e) {
        console.error("[midflight] fee split failed", e);
      }

      const { appendLedger } = await import("@/lib/event-ledger.server");
      await appendLedger({
        entity: "closing_pipeline_items",
        entityId: dealId,
        operation: "FUNDS_CLEARED",
        actor: "midflight_reconcile",
        after: { settlement_reference: hit.ref, cleared_amount: fee },
      });

      out.cleared++;
      out.deals.push({ id: dealId, action: "cleared", amount_usd: fee, ref: hit.ref });
    } catch (e) {
      out.errors.push(`${dealId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return out;
}
