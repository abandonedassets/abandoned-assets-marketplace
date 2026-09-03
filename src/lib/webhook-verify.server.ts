// Shared cryptographic verification + replay protection for public webhooks.
import { createHmac, timingSafeEqual } from "crypto";

function safeEq(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Verifies a Svix-style signature (Resend / SendGrid inbound parse):
 *   svix-id, svix-timestamp, svix-signature: "v1,<base64>"
 * Falls back to a plain HMAC-SHA256 hex header (x-webhook-signature) over the raw body.
 */
export function verifyInboundSignature(input: {
  headers: Headers;
  rawBody: string;
  secret: string;
  toleranceSec?: number;
}): { ok: boolean; eventId: string | null; reason?: string } {
  const { headers, rawBody, secret } = input;
  const tolerance = input.toleranceSec ?? 300;
  if (!secret) return { ok: false, eventId: null, reason: "secret_not_configured" };

  const svixId = headers.get("svix-id") ?? headers.get("webhook-id");
  const svixTs = headers.get("svix-timestamp") ?? headers.get("webhook-timestamp");
  const svixSig = headers.get("svix-signature") ?? headers.get("webhook-signature");

  if (svixId && svixTs && svixSig) {
    const age = Math.abs(Date.now() / 1000 - Number(svixTs));
    if (!isFinite(age) || age > tolerance) return { ok: false, eventId: svixId, reason: "timestamp_out_of_tolerance" };
    const key = secret.startsWith("whsec_")
      ? Buffer.from(secret.slice(6), "base64")
      : Buffer.from(secret, "utf8");
    const expected = createHmac("sha256", key)
      .update(`${svixId}.${svixTs}.${rawBody}`)
      .digest("base64");
    const provided = svixSig
      .split(" ")
      .map((p) => (p.includes(",") ? p.split(",")[1] : p))
      .filter(Boolean);
    const ok = provided.some((p) => safeEq(p, expected));
    return { ok, eventId: svixId, reason: ok ? undefined : "signature_mismatch" };
  }

  const hmacHeader =
    headers.get("x-webhook-signature") ?? headers.get("x-signature") ?? null;
  if (hmacHeader) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const provided = hmacHeader.replace(/^sha256=/i, "").trim();
    const ok = safeEq(provided, expected);
    return { ok, eventId: null, reason: ok ? undefined : "signature_mismatch" };
  }

  return { ok: false, eventId: null, reason: "missing_signature_header" };
}

/**
 * All candidate Stripe signing secrets. A Stripe account can have several
 * endpoints (live/test, primary/backup), each with its own `whsec_`.
 * STRIPE_WEBHOOK_SECRET may hold a comma/space/newline separated list.
 */
export function stripeSigningSecrets(primary?: string): string[] {
  const raw = [
    primary ?? process.env["STRIPE_WEBHOOK_SECRET"] ?? "",
    process.env["STRIPE_WEBHOOK_SECRET_2"] ?? "",
    process.env["STRIPE_WEBHOOK_SECRET_ALT"] ?? "",
  ].join(",");
  return Array.from(
    new Set(
      raw
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

/**
 * Verifies Stripe's native `Stripe-Signature` header (t=<ts>,v1=<hex>) over the
 * EXACT raw body text. Never JSON.parse before calling this.
 */
export function verifyStripeSignature(input: {
  headers: Headers;
  rawBody: string;
  secret: string;
  toleranceSec?: number;
}): { ok: boolean; reason?: string } {
  const { headers, rawBody } = input;
  const tolerance = input.toleranceSec ?? 600;
  const secrets = stripeSigningSecrets(input.secret);
  if (!secrets.length) return { ok: false, reason: "secret_not_configured" };
  const header = headers.get("stripe-signature");
  if (!header) return { ok: false, reason: "missing_stripe_signature" };

  let ts = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=");
    if (!k || !v) continue;
    if (k.trim() === "t") ts = v.trim();
    if (k.trim() === "v1") v1.push(v.trim());
  }
  if (!ts || !v1.length) return { ok: false, reason: "malformed_stripe_signature" };

  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!isFinite(age) || age > tolerance) return { ok: false, reason: "timestamp_out_of_tolerance" };

  for (const secret of secrets) {
    const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
    if (v1.some((s) => safeEq(s, expected))) return { ok: true };
  }
  return { ok: false, reason: "signature_mismatch" };
}

/** Returns true when this event was already processed (replay). 24h window. */
export async function claimWebhookEvent(eventId: string | null, source: string) {
  if (!eventId) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("webhook_replay_guard" as never)
    .insert({ event_id: eventId, source } as never);
  if (error && (error as { code?: string }).code === "23505") return true;
  return false;
}

/** Immutable audit write. Never throws — auditing must not stall the pipeline. */
export async function writeAuditLog(row: {
  event_type: string;
  reason?: string;
  pipeline_item_id?: string | null;
  raw_payload?: unknown;
  llm_confidence_score?: number | null;
  ip_address?: string | null;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("system_audit_logs" as never).insert({
      event_type: row.event_type,
      reason: row.reason ?? row.event_type,
      pipeline_item_id: row.pipeline_item_id ?? null,
      payload: (row.raw_payload ?? null) as never,
      llm_confidence_score: row.llm_confidence_score ?? null,
      ip_address: row.ip_address ?? null,
    } as never);
  } catch (e) {
    console.error("[audit] write failed", e);
  }
}

export function clientIp(request: Request): string | null {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}
