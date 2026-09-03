// Transactional email provider webhook (Resend / SendGrid / Postmark).
// Signature-verified. Maps provider delivery events into offer_delivery_logs.
import { createFileRoute } from "@tanstack/react-router";

type Mapped = {
  status: "DISPATCHED" | "DELIVERED" | "OPENED" | "CLICKED" | null;
  email: string | null;
  subject: string | null;
  messageId: string | null;
  ip: string | null;
  ua: string | null;
  contractId: string | null;
  buyerId: string | null;
};

function firstEmail(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  if (v && typeof v === "object") {
    const e = (v as Record<string, unknown>)["email"];
    if (typeof e === "string") return e;
  }
  return null;
}

function mapEvent(payload: Record<string, any>): Mapped {
  const type = String(
    payload.type ?? payload.event ?? payload.RecordType ?? payload.record_type ?? "",
  ).toLowerCase();
  const d: Record<string, any> = payload.data ?? payload;

  const status =
    /deliver/.test(type) ? ("DELIVERED" as const)
    : /click/.test(type) ? ("CLICKED" as const)
    : /open/.test(type) ? ("OPENED" as const)
    : /sent|processed|queued/.test(type) ? ("DISPATCHED" as const)
    : null;

  const headers: Record<string, string> = {};
  const rawHeaders = d.headers ?? d.Headers ?? [];
  if (Array.isArray(rawHeaders)) {
    for (const h of rawHeaders) {
      const n = String(h?.name ?? h?.Name ?? "").toLowerCase();
      if (n) headers[n] = String(h?.value ?? h?.Value ?? "");
    }
  } else if (rawHeaders && typeof rawHeaders === "object") {
    for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = String(v);
  }

  return {
    status,
    email: firstEmail(d.to ?? d.email ?? d.Recipient ?? d.recipient),
    subject: d.subject ?? d.Subject ?? null,
    messageId: d.email_id ?? d.message_id ?? d.MessageID ?? d.sg_message_id ?? d.id ?? null,
    ip: d.ip ?? d.ip_address ?? d.Geo?.IP ?? d.geo?.ip ?? null,
    ua: d.user_agent ?? d.UserAgent ?? d.useragent ?? null,
    contractId: headers["x-asset-id"] ?? d.contract_id ?? d.tags?.contract_id ?? null,
    buyerId: headers["x-buyer-id"] ?? d.buyer_id ?? d.tags?.buyer_id ?? null,
  };
}

export const Route = createFileRoute("/api/v1/webhooks/email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const secret =
          process.env["EMAIL_WEBHOOK_SECRET"] ??
          process.env["RESEND_WEBHOOK_SECRET"] ??
          "";

        const { verifyInboundSignature } = await import("@/lib/webhook-verify.server");
        const v = verifyInboundSignature({ headers: request.headers, rawBody, secret });
        if (!v.ok) {
          console.error("[email-webhook] signature rejected:", v.reason);
          return new Response(JSON.stringify({ ok: false, error: "invalid_signature" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let payload: Record<string, any>;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "bad_json" }), { status: 400 });
        }

        const events = Array.isArray(payload) ? payload : [payload];
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let written = 0;

        for (const raw of events) {
          try {
            const m = mapEvent(raw as Record<string, any>);
            if (!m.status) continue;
            const { error } = await supabaseAdmin.from("offer_delivery_logs").insert({
              contract_id: m.contractId,
              buyer_id: m.buyerId,
              status: m.status,
              recipient_email: m.email,
              subject: m.subject,
              provider_message_id: m.messageId,
              ip_address: m.ip,
              user_agent: m.ua,
              meta: { source: "provider_webhook" } as never,
            } as never);
            if (error) console.error("[email-webhook] insert failed", error.message);
            else written++;
          } catch (e) {
            console.error("[email-webhook] event failed", e);
          }
        }

        return new Response(JSON.stringify({ ok: true, written }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
