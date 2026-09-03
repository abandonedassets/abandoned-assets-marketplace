// M2M settlement ingestion + throttled Stripe payout release.
// GET  -> runs the sweep cycle over pending payloads already in the DB.
// POST -> accepts an institutional M2M payload (or batch) and pulls/reconciles
//         it straight into the Stripe balance, then runs the payout guard.
import { createFileRoute } from "@tanstack/react-router";

async function runCycle() {
  try {
    const mod = await import("@/lib/stripe-settlement.server");
    // Autonomous daemon pass: mint virtual receivers for cleared contracts,
    // then settle. Fail-forward — minting errors never block the sweep.
    let minted: unknown = null;
    try {
      minted = await mod.mintReceiversForClearedContracts(25);
    } catch (e) {
      console.error("[stripe-settlement-cycle] mint failed", e);
    }
    const { runSettlementCycle } = mod;
    const cycle = await runSettlementCycle(50);
    const report = { ...cycle, minted };
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[stripe-settlement-cycle] failed", e);
    const { notifyAdmin } = await import("@/lib/notify.server");
    await notifyAdmin(`🚨 CRITICAL: settlement cycle failed — ${e instanceof Error ? e.message : String(e)}`, true);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

async function receive({ request }: { request: Request }) {
  try {
    const { ipShieldCheck } = await import("@/lib/ip-shield.server");
    const blocked = ipShieldCheck(request);
    if (blocked) return blocked;
    const raw = await request.text();
    if (!raw.trim()) return runCycle();

    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    // Inbound Stripe webhook: buyer machine pushed cash across the rail.
    if (body?.object === "event" || typeof body?.type === "string") {
      // Level 4 gate: when STRIPE_WEBHOOK_SECRET is bound, reject anything not
      // cryptographically signed by Stripe's servers (forged wire-clearance shield).
      const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (whSecret) {
        const {
          verifyInboundSignature,
          verifyStripeSignature,
          claimWebhookEvent,
          writeAuditLog,
          clientIp,
        } = await import("@/lib/webhook-verify.server");
        // Stripe's native header takes precedence and is verified against the
        // EXACT raw body text (no JSON re-serialization).
        const v = request.headers.get("stripe-signature")
          ? { ...verifyStripeSignature({ headers: request.headers, rawBody: raw, secret: whSecret }), eventId: typeof body?.id === "string" ? body.id : null }
          : verifyInboundSignature({
              headers: request.headers,
              rawBody: raw,
              secret: whSecret,
            });
        if (!v.ok) {
          await writeAuditLog({
            event_type: "STRIPE_WEBHOOK_REJECTED",
            reason: v.reason ?? "signature_failed",
            ip_address: clientIp(request),
          });
          return Response.json({ ok: false, error: "invalid_signature" }, { status: 401 });
        }
        if (await claimWebhookEvent(v.eventId, "stripe-settlement")) {
          return Response.json({ ok: true, skipped: "duplicate_event" });
        }
      }
      const { handleStripeEvent } = await import("@/lib/stripe-settlement.server");
      const result = await handleStripeEvent(body);
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    // Outbound provisioning: mint virtual bank details for a deal package.
    if (body?.provision) {
      const { provisionVirtualAccount } = await import("@/lib/stripe-settlement.server");
      const p = body.provision === true ? {} : body.provision;
      const account = await provisionVirtualAccount({
        deal_id: p?.deal_id ?? body?.deal_id ?? null,
        counterparty: p?.counterparty ?? body?.counterparty ?? null,
      });
      return Response.json(account, { headers: { "Cache-Control": "no-store" } });
    }

    const payloads = Array.isArray(body)
      ? body
      : Array.isArray(body?.payloads)
        ? body.payloads
        : body?.deal_id || body?.transaction_id || body?.authorization
          ? [body]
          : null;

    if (!payloads?.length) return runCycle();

    const mod = await import("@/lib/stripe-settlement.server");
    const ingestion = await mod.settleM2MBatch(payloads);
    const payout = await mod.throttledRelease();

    return Response.json(
      {
        ...ingestion,
        payout: {
          triggered: payout.triggered,
          cap_usd: payout.cap_usd,
          payout_id: payout.payout_id ?? null,
          payout_status: payout.payout_status ?? payout.reason ?? "not_triggered",
          retained_usd: payout.retained_usd,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[stripe-settlement-cycle] payload failed", e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/stripe-settlement-cycle")({
  server: { handlers: { GET: runCycle, POST: receive } },
});
