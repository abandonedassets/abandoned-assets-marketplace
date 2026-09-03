// Pre-flight endpoint verification for buyer buy boxes.
// Live-only enforcement: a buyer endpoint must answer on the wire before any
// packet is dispatched to it. Fail-forward — never throws into the cron.

const TIMEOUT_MS = 5_000;
const REVERIFY_AFTER_MS = 6 * 60 * 60 * 1000; // 6h

const SYNTHETIC_HOST_PATTERNS = [
  "synthetic-buyers.io",
  "httpbin.org",
  "postman-echo.com",
  "example.com",
  "localhost",
  "127.0.0.1",
  "lovable.app",
];

export function isSyntheticEndpoint(url: string | null | undefined): boolean {
  if (!url) return true;
  const u = url.toLowerCase();
  return SYNTHETIC_HOST_PATTERNS.some((p) => u.includes(p));
}

// Self-addressed or fabricated inboxes are not demand — they must never count
// as a live counterparty nor receive a dispatch.
const SYNTHETIC_EMAIL_PATTERNS = [
  "synthetic-buyers.io",
  "example.com",
  "example.org",
  "test.com",
  "mailinator.com",
  "abandonedassets@gmail.com",
  "abandonedasset.online",
];

export function isSyntheticContact(email: string | null | undefined): boolean {
  if (!email) return true;
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return true;
  return SYNTHETIC_EMAIL_PATTERNS.some((p) => e.includes(p));
}


export type PreflightResult = {
  ok: boolean;
  status: "VERIFIED" | "UNREACHABLE" | "SYNTHETIC" | "MISSING";
  http_code: number | null;
  error: string | null;
  cached?: boolean;
  cryptographic?: boolean;
};

/**
 * Cryptographic challenge-response pre-flight.
 * Sends X-M2M-Challenge: <random hex 64>. The node must reply 200/202; when it
 * also returns X-M2M-Response = HMAC-SHA256(challenge, public_key) it is tagged
 * CRYPTOGRAPHICALLY_VERIFIED and gets high-tier routing priority.
 */
export async function challengeBuyBox(
  url: string,
  publicKey?: string | null,
): Promise<{ ok: boolean; http_code: number | null; error: string | null; cryptographic: boolean }> {
  if (!url) return { ok: false, http_code: null, error: "no_webhook_url", cryptographic: false };
  if (isSyntheticEndpoint(url))
    return { ok: false, http_code: null, error: "synthetic_endpoint", cryptographic: false };

  const { createHmac, randomBytes } = await import("crypto");
  const challenge = randomBytes(32).toString("hex");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-M2M-Challenge": challenge,
        "X-Execution-TTL-MS": "5000",
      },
      body: JSON.stringify({ preflight: true, challenge }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const reachable = res.status === 200 || res.status === 202;
    let cryptographic = false;
    if (reachable && publicKey) {
      const expected = createHmac("sha256", publicKey).update(challenge).digest("hex");
      const got = (res.headers.get("x-m2m-response") ?? "").trim().toLowerCase();
      cryptographic = got.length > 0 && got === expected;
    }
    return {
      ok: reachable,
      http_code: res.status,
      error: reachable ? null : `HTTP ${res.status}`,
      cryptographic,
    };
  } catch (e) {
    return {
      ok: false,
      http_code: null,
      error: e instanceof Error ? e.message : String(e),
      cryptographic: false,
    };
  }
}

async function ping(url: string): Promise<{ code: number | null; error: string | null }> {
  for (const method of ["HEAD", "POST"] as const) {
    try {
      const res = await fetch(url, {
        method,
        headers: method === "POST" ? { "content-type": "application/json" } : undefined,
        body: method === "POST" ? JSON.stringify({ preflight: true }) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // 405 = method not allowed but host is alive; treat as reachable.
      if (res.status >= 200 && res.status <= 405) return { code: res.status, error: null };
      if (method === "POST") return { code: res.status, error: `HTTP ${res.status}` };
    } catch (e) {
      if (method === "POST") return { code: null, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { code: null, error: "unreachable" };
}


/**
 * Verifies a buy box endpoint before dispatch.
 * 200–405 -> VERIFIED. DNS/connect/timeout -> UNREACHABLE + active=false.
 * Synthetic/placeholder hosts are rejected outright and deactivated.
 */
export async function preflightBuyBox(box: {
  id: string;
  webhook_url?: string | null;
  endpoint_status?: string | null;
  endpoint_checked_at?: string | null;
}): Promise<PreflightResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const url = box.webhook_url ?? null;

    if (!url) return { ok: false, status: "MISSING", http_code: null, error: "no_webhook_url" };

    if (isSyntheticEndpoint(url)) {
      await supabaseAdmin
        .from("buyer_buy_boxes")
        .update({
          endpoint_status: "SYNTHETIC",
          endpoint_checked_at: new Date().toISOString(),
          endpoint_last_code: null,
          active: false,
        } as never)
        .eq("id", box.id);
      return { ok: false, status: "SYNTHETIC", http_code: null, error: "synthetic_endpoint" };
    }

    // Skip re-verification when recently verified (keeps the 5-min cron cheap).
    if (
      box.endpoint_status === "VERIFIED" &&
      box.endpoint_checked_at &&
      Date.now() - new Date(box.endpoint_checked_at).getTime() < REVERIFY_AFTER_MS
    ) {
      return { ok: true, status: "VERIFIED", http_code: null, error: null, cached: true };
    }

    const { code, error } = await ping(url);
    const reachable = code !== null && code >= 200 && code <= 405;
    const now = new Date().toISOString();

    await supabaseAdmin
      .from("buyer_buy_boxes")
      .update({
        endpoint_status: reachable ? "VERIFIED" : "UNREACHABLE",
        endpoint_checked_at: now,
        endpoint_last_code: code,
        ...(reachable ? {} : { active: false }),
      } as never)
      .eq("id", box.id);

    if (!reachable) {
      await supabaseAdmin.from("offer_delivery_logs").insert({
        buyer_id: box.id,
        status: "FAILED",
        meta: {
          channel: "PREFLIGHT",
          box_id: box.id,
          webhook_url: url,
          http_code: code,
          error_message: (error ?? "unreachable").slice(0, 300),
        } as never,
      } as never);
    }

    return {
      ok: reachable,
      status: reachable ? "VERIFIED" : "UNREACHABLE",
      http_code: code,
      error: reachable ? null : error,
    };
  } catch (e) {
    // Helper failure must never break the sweep — skip the buyer instead.
    return { ok: false, status: "UNREACHABLE", http_code: null, error: (e as Error).message };
  }
}
