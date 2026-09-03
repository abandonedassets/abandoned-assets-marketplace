// Dedicated, isolated Stripe webhook lane.
// Authenticates ONLY with the native `stripe-signature` header against
// STRIPE_WEBHOOK_SECRET. The Bluevine/Flow wire listener
// (/api/public/hooks/inbound-wire-received) keeps its own HMAC gate.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/stripe-settlement")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          listener: "stripe_settlement",
          auth: "stripe-signature header + STRIPE_WEBHOOK_SECRET",
          events: ["checkout.session.completed", "charge.succeeded", "payment_intent.succeeded"],
          configured: Boolean(process.env["STRIPE_WEBHOOK_SECRET"]),
        }),
      POST: async ({ request }) => {
        // RAW body first — never JSON.parse before verification.
        const raw = await request.text();
        const secret = process.env["STRIPE_WEBHOOK_SECRET"] ?? "";
        if (!secret) {
          return Response.json(
            { ok: false, error: "stripe_webhook_secret_not_configured" },
            { status: 503 },
          );
        }

        const { verifyStripeSignature, claimWebhookEvent, writeAuditLog, clientIp } = await import(
          "@/lib/webhook-verify.server"
        );

        const sigHeader = request.headers.get("stripe-signature");
        if (!sigHeader) {
          return Response.json({ ok: false, error: "missing_stripe_signature" }, { status: 401 });
        }

        const v = verifyStripeSignature({ headers: request.headers, rawBody: raw, secret });
        if (!v.ok) {
          const url = new URL(request.url);
          await writeAuditLog({
            event_type: "STRIPE_WEBHOOK_REJECTED",
            reason: v.reason ?? "signature_failed",
            ip_address: clientIp(request),
            raw_payload: {
              host: request.headers.get("host") ?? url.host,
              path: url.pathname,
              body_bytes: raw.length,
              sig_header_present: true,
            },
          });
          return Response.json(
            { ok: false, error: "invalid_signature", reason: v.reason ?? "signature_mismatch" },
            { status: 401 },
          );
        }

        let event: any;
        try {
          event = JSON.parse(raw);
        } catch {
          return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
        }

        const eventId = typeof event?.id === "string" ? event.id : null;
        if (await claimWebhookEvent(eventId, "stripe-settlement-lane")) {
          return Response.json({ ok: true, skipped: "duplicate_event", event_id: eventId });
        }

        // AML review lane: park / release without human intervention.
        try {
          const { handleReviewEvent } = await import("@/lib/clearing-freeze.server");
          const r = await handleReviewEvent(event);
          if (r.handled) return Response.json({ ok: true, ...r, event_id: eventId });
        } catch (e) {
          console.error("[stripe-settlement] review lane failed", e);
        }

        // RAIL 1: micro Data Access Toll -> unlock + Bluevine heavy settlement.
        try {
          const { handleTollEvent } = await import("@/lib/dual-rail.server");
          const toll = await handleTollEvent(event);
          if (toll.handled)
            return Response.json({ ok: true, lane: "data_access_toll", ...toll, event_id: eventId });
        } catch (e) {
          console.error("[stripe-settlement] toll lane failed", e);
        }

        // Assignment-fee lane: authorization holds + abandoned checkouts.
        try {
          const {
            recordAssignmentFeeAuthorization,
            recordAssignmentFeeTerminalEvent,
            markCheckoutAbandoned,
          } = await import(
            "@/lib/assignment-fee.server"
          );
          const terminal = await recordAssignmentFeeTerminalEvent(event);
          if (terminal.handled) {
            return Response.json({
              ok: true,
              lane: "assignment_fee_terminal",
              ...terminal,
              event_id: eventId,
            });
          }
          const auth = await recordAssignmentFeeAuthorization(event);
          if (auth.handled) {
            // Data Gating Protocol: money verified -> coordinates released.
            let unlock: unknown = null;
            if (auth.deal_id) {
              const { deliverUnlockPacket } = await import("@/lib/data-gate.server");
              unlock = await deliverUnlockPacket(auth.deal_id);
            }
            return Response.json({
              ok: true,
              lane: "assignment_fee_authorized",
              unlock,
              deal_id: auth.deal_id,
              intent: auth.intent,
              event_id: eventId,
            });
          }
          if (await markCheckoutAbandoned(event)) {
            return Response.json({ ok: true, lane: "checkout_abandoned", event_id: eventId });
          }
        } catch (e) {
          console.error("[stripe-settlement] assignment-fee lane failed", e);
        }

        // Fail-forward: a handler error is logged, never re-thrown at Stripe.
        try {
          const { handleStripeEvent } = await import("@/lib/stripe-settlement.server");
          const result = await handleStripeEvent(event);
          return Response.json(
            { ...result, event_id: eventId },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e) {
          console.error("[stripe-settlement] handler failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e), event_id: eventId },
            { status: 200 },
          );
        }
      },
    },
  },
});
