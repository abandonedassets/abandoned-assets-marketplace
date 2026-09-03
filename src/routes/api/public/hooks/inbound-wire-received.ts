// Inbound Liquidity Capture — institutional wire notification listener.
// POST /api/public/hooks/inbound-wire-received
// HMAC-SHA256 signed (x-webhook-signature / svix headers) over the raw body.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Schema = z.object({
  event_id: z.string().min(1).max(200).optional(),
  fbo_account_number: z.string().min(4).max(40).optional(),
  deal_id: z.string().uuid().optional(),
  amount_usd: z.number().min(0).max(500_000_000),
  sender_reference: z.string().max(255).optional(),
});

export const Route = createFileRoute("/api/public/hooks/inbound-wire-received")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          listener: "inbound_wire_received",
          expects: {
            fbo_account_number: "string (or deal_id)",
            amount_usd: "number",
            event_id: "string",
          },
        }),
      POST: async ({ request }) => {
        // RAW body first — never parse before cryptographic verification.
        const raw = await request.text();

        // Stripe lane: if Stripe posted here instead of /hooks/stripe-settlement,
        // verify the native signature over the untouched raw body and settle.
        if (request.headers.get("stripe-signature")) {
          const stripeSecret = process.env["STRIPE_WEBHOOK_SECRET"] ?? "";
          if (!stripeSecret) {
            return Response.json(
              { received: false, error: "stripe_webhook_secret_not_configured" },
              { status: 503 },
            );
          }
          const { verifyStripeSignature, claimWebhookEvent } = await import(
            "@/lib/webhook-verify.server"
          );
          const sv = verifyStripeSignature({
            headers: request.headers,
            rawBody: raw,
            secret: stripeSecret,
          });
          if (!sv.ok) {
            return Response.json(
              { received: false, error: sv.reason ?? "invalid_signature" },
              { status: 401 },
            );
          }
          let event: any;
          try {
            event = JSON.parse(raw);
          } catch {
            return Response.json({ received: false, error: "invalid_json" }, { status: 400 });
          }
          const evtId = typeof event?.id === "string" ? event.id : null;
          if (await claimWebhookEvent(evtId, "inbound-wire-stripe-lane")) {
            return Response.json({ received: true, replay: true });
          }
          try {
            const { handleStripeEvent } = await import("@/lib/stripe-settlement.server");
            const result = await handleStripeEvent(event);
            return Response.json({ received: true, ...result, event_id: evtId });
          } catch (e) {
            console.error("[inbound-wire/stripe] handler failed", e);
            // 200 keeps Stripe from retry-looping; failure is logged server-side.
            return Response.json({ received: true, settled: false, error: String(e) });
          }
        }

        const secret =
          process.env["INBOUND_WIRE_SECRET"] || process.env["FLOW_CALLBACK_SECRET"] || "";
        if (!secret) {
          return Response.json(
            { ok: false, error: "listener_secret_not_configured" },
            { status: 503 },
          );
        }
        const { verifyInboundSignature, claimWebhookEvent } = await import(
          "@/lib/webhook-verify.server"
        );
        const v = verifyInboundSignature({ headers: request.headers, rawBody: raw, secret });
        if (!v.ok) {
          return Response.json({ ok: false, error: v.reason ?? "invalid_signature" }, { status: 401 });
        }

        let parsed: z.infer<typeof Schema>;
        try {
          parsed = Schema.parse(JSON.parse(raw));
        } catch (e) {
          return Response.json(
            { ok: false, error: "invalid_input", message: String((e as Error).message) },
            { status: 400 },
          );
        }
        if (!parsed.fbo_account_number && !parsed.deal_id) {
          return Response.json(
            { ok: false, error: "fbo_account_number_or_deal_id_required" },
            { status: 400 },
          );
        }

        const eventId = parsed.event_id ?? v.eventId ?? null;
        if (await claimWebhookEvent(eventId, "inbound_wire")) {
          return Response.json({ ok: true, replay: true });
        }

        try {
          const { reconcileInboundWire } = await import("@/lib/fbo.server");
          const result = await reconcileInboundWire({
            event_id: eventId,
            fbo_account_number: parsed.fbo_account_number ?? null,
            deal_id: parsed.deal_id ?? null,
            amount_usd: parsed.amount_usd,
            sender_reference: parsed.sender_reference ?? null,
            raw: parsed,
          });
          return Response.json({ ok: true, ...result });
        } catch (e) {
          console.error("[inbound-wire] failed", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
        }
      },
    },
  },
});
