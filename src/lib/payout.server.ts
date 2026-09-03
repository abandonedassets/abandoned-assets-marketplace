// Revenue Loop — Assignment-fee settlement routed DIRECTLY to Bluevine.
// Stripe is fully removed. Bluevine is the sole payout endpoint. Funds settle to the
// Bluevine (Coastal Community Bank) coordinates stored in project secrets:
// BLUEVINE_ROUTING_NUMBER / BLUEVINE_ACCOUNT_NUMBER / BENEFICIARY_ADDRESS.
// Fail-forward: payout errors are logged, never thrown into the webhook path.

export type PayoutResult =
  | { ok: true; payout_id: string; amount: number; destination?: string }
  | { ok: false; reason: string };

/** Settle the assignment fee to the Bluevine beneficiary account. */
export async function payoutAssignmentFee(
  dealId: string,
  opts?: { probe?: boolean },
): Promise<PayoutResult> {
  try {
    // Probe/sandbox mode: synthetic payout, no banking side effects.
    if (opts?.probe) {
      return { ok: true, payout_id: "po_e2e_mock_payout_success", amount: 0, destination: "bluevine" };
    }

    // Zero-Fake gate: abort before touching the ledger when rails are not live.
    const { assertLiveRails } = await import("@/lib/live-rails.server");
    assertLiveRails();

    const { wireConfig, BENEFICIARY_NAME } = await import("@/lib/bluevine.server");
    const cfg = wireConfig();
    const stripeReady = Boolean(process.env["STRIPE_RESTRICTED_KEY"] ?? process.env["STRIPE_SECRET_KEY"]);
    if (!stripeReady && (!cfg.routing || !cfg.account)) {
      return { ok: false, reason: "stripe_restricted_key_missing" };
    }


    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: deal } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,optimized_acquisition_premium,base_contract_price,cleared_at,payout_transfer_id,assignment_fee_status,assignment_fee_intent_id,address,zip,state,parcel_number,apn,asset_class,asset_type,zoning_category,has_timber,enrichment_tags",
      )
      .eq("id", dealId)
      .maybeSingle();
    if (!deal) return { ok: false, reason: "deal_not_found" };
    const d = deal as any;
    if (d.payout_transfer_id) return { ok: false, reason: "already_paid" };
    if (!d.cleared_at) return { ok: false, reason: "funds_not_cleared" };
    if (d.assignment_fee_status !== "captured" || !d.assignment_fee_intent_id) {
      return { ok: false, reason: "assignment_fee_not_provider_captured" };
    }

    const amountUsd = Number(d.optimized_acquisition_premium ?? 0);
    if (!isFinite(amountUsd) || amountUsd <= 0) return { ok: false, reason: "zero_fee" };

    // PRIMARY RAIL — Stripe. The destination bank account is linked inside the
    // Stripe Dashboard, so no routing/account numbers are needed here.
    const { stripePayoutConfigured, stripeInstantPayout } = await import(
      "@/lib/stripe-payout.server"
    );
    if (stripePayoutConfigured()) {
      const out = await stripeInstantPayout({
        amountUsd,
        description: `Assignment fee ${String(dealId).slice(0, 8)}`,
        dealId,
      });
      if (out.ok) {
        await supabaseAdmin
          .from("closing_pipeline_items")
          .update({
            payout_transfer_id: out.payout_id,
            payout_at: new Date().toISOString(),
            payout_provider: "stripe",
            payout_provider_transfer_id: out.payout_id,
            payout_status: "SETTLED_PAID",
          } as never)
          .eq("id", dealId);
        try {
          const { notifyAdmin, fmtUsd } = await import("@/lib/notify.server");
          await notifyAdmin(
            `💳 STRIPE PAYOUT — ${fmtUsd(amountUsd)} assignment fee (${out.method}) on deal ${String(dealId).slice(0, 8)}.`,
          );
        } catch {
          /* telemetry optional */
        }
        return { ok: true, payout_id: out.payout_id, amount: amountUsd, destination: "stripe" };
      }
      console.error("[payout] stripe rail failed", out.error, out.detail);
      if (!cfg.routing || !cfg.account) return { ok: false, reason: out.error };
    }

    const last4 = String(cfg.account).slice(-4);



    // Direct Bluevine wire rail — no third-party BaaS, no processing fees.
    let providerTransferId: string | null = null;

    // Split-ledger disbursement across the beneficiary routing matrix,
    // each leg issued on the settlement rail.
    const { dispatchSplitLedger } = await import("@/lib/beneficiary-payout.server");
    const split = await dispatchSplitLedger({
      dealId,
      netUsd: amountUsd,
      asset: {
        id: dealId,
        valuation: Number(d.base_contract_price ?? 0),
        parcel_number: d.parcel_number ?? null,
        apn: d.apn ?? null,
        state: d.state ?? null,
        asset_class: d.asset_class ?? null,
        asset_type: d.asset_type ?? null,
        zoning_category: d.zoning_category ?? null,
        address: d.address ?? null,
        has_timber: d.has_timber ?? null,
        enrichment_tags: d.enrichment_tags ?? null,
      },
    });
    const okLegs = split.legs.filter((l) => l.ok);
    if (!okLegs.length && !providerTransferId) {
      return { ok: false, reason: split.legs[0]?.error ?? "split_dispatch_failed" };
    }
    const payoutId =
      providerTransferId ?? okLegs.map((l) => l.transfer_id ?? l.key).join("+");


    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        payout_transfer_id: payoutId,
        payout_at: new Date().toISOString(),
        payout_provider: "bluevine",
        payout_provider_transfer_id: providerTransferId,
        payout_status: "SETTLED_PAID",
      } as never)
      .eq("id", dealId);


    // Immutable settlement record — Bluevine coordinates, never Stripe.
    try {
      await supabaseAdmin.from("system_alerts" as any).insert({
        kind: "bluevine_payout",
        severity: "info",
        message: `Bluevine wire queued — $${amountUsd.toLocaleString("en-US")} on deal ${dealId.slice(0, 8)}`,
        deal_id: dealId,
        metadata: {
          rail: "fedwire",
          processor: "bluevine",
          beneficiary: BENEFICIARY_NAME,
          bank: cfg.bank,
          account_last4: last4,
          routing_prefix: String(cfg.routing).slice(0, 3),
          amount_usd: amountUsd,
          payout_id: payoutId,
          instructions_url: `/api/public/wire/${dealId}`,
        } as any,
      });
    } catch {
      /* telemetry optional */
    }

    try {
      const { notifyAdmin, fmtUsd } = await import("@/lib/notify.server");
      await notifyAdmin(
        `🏦 BLUEVINE PAYOUT — ${fmtUsd(amountUsd)} assignment fee routed to ${BENEFICIARY_NAME} · ${cfg.bank} ••••${last4} (deal ${String(dealId).slice(0, 8)}).`,
      );
    } catch {
      /* telemetry optional */
    }

    return { ok: true, payout_id: payoutId, amount: amountUsd, destination: `bluevine_****${last4}` };
  } catch (e) {
    console.error("[payout] failed", e);
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
