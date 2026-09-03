// Institutional inbound authentication: HMAC-SHA256 request signing +
// strict client-transaction idempotency.
//
// Signing scheme (documented at GET /api/public/v1/spec):
//   canonical = `${METHOD}\n${PATH}\n${X-M2M-Timestamp}\n${sha256(body)}`
//   X-M2M-Signature = hex(HMAC_SHA256(canonical, shared_secret))
//   X-M2M-Key-Id    = institutional key prefix
//   X-Client-Txn-Id = caller-generated unique transaction id (mandatory on writes)
//
// Replay protection: 300s clock skew window + persisted signature/txn receipts.

import { createHash, createHmac, timingSafeEqual, verify } from "crypto";

export const CLOCK_SKEW_SECONDS = 300;
export const DB_TIMEOUT_MS = 5000;

export const M2M_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-Api-Key, X-M2M-Key-Id, X-M2M-Timestamp, X-M2M-Signature, X-M2M-Ecdsa, X-Client-Txn-Id",
  "Access-Control-Expose-Headers":
    "X-M2M-Signature, X-M2M-Timestamp, X-Idempotent-Replay, X-Client-Txn-Id",
};

export type SignedKey = {
  id: string;
  label: string | null;
  fund_id: string | null;
  sandbox: boolean;
  rate_limit_per_minute: number | null;
};

export type VerifyResult =
  | { ok: true; key: SignedKey; body: string; txnId: string | null; canonical: string }
  | { ok: false; status: number; error: string; detail?: string };

export function sha256Hex(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

export function canonicalString(
  method: string,
  path: string,
  timestamp: string,
  body: string,
) {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${sha256Hex(body)}`;
}

/** Deterministic signature a client must reproduce. Exported for the UAT enclave. */
export function signCanonical(canonical: string, secret: string) {
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

function safeEq(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verifies an inbound institutional request.
 * `requireTxnId` is enforced for any state-changing call.
 */
export async function verifySignedRequest(
  request: Request,
  opts: { requireTxnId?: boolean } = {},
): Promise<VerifyResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const url = new URL(request.url);
  const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();

  const keyId = (request.headers.get("x-m2m-key-id") ?? "").trim();
  const timestamp = (request.headers.get("x-m2m-timestamp") ?? "").trim();
  const signature = (request.headers.get("x-m2m-signature") ?? "").trim().toLowerCase();
  const txnId = (request.headers.get("x-client-txn-id") ?? "").trim() || null;

  if (!keyId || !timestamp || !signature)
    return {
      ok: false,
      status: 401,
      error: "missing_signature",
      detail: "X-M2M-Key-Id, X-M2M-Timestamp and X-M2M-Signature are required",
    };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts))
    return { ok: false, status: 401, error: "bad_timestamp" };
  const skew = Math.abs(Date.now() / 1000 - (ts > 1e11 ? ts / 1000 : ts));
  if (skew > CLOCK_SKEW_SECONDS)
    return { ok: false, status: 401, error: "stale_timestamp", detail: `skew=${Math.round(skew)}s` };

  if (opts.requireTxnId && !txnId)
    return {
      ok: false,
      status: 400,
      error: "missing_client_txn_id",
      detail: "X-Client-Txn-Id is mandatory on execution requests",
    };
  const { data: row, error: dbError } = await Promise.race([
    supabaseAdmin
      .from("institutional_api_keys")
      .select("id, label, fund_id, sandbox, is_active, hmac_secret, rate_limit_per_minute, first_intent_at, ecdsa_public_key, require_asymmetric, onboarding_state")
      .eq("key_prefix", keyId)
      .maybeSingle(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Database timeout")), DB_TIMEOUT_MS))
  ]) as any;

  if (dbError || !row) {
    if (dbError?.message === "Database timeout") return { ok: false, status: 503, error: "service_unavailable" };
    return { ok: false, status: 401, error: "unknown_key" };
  }
  const k = row;
  if (!k.is_active) return { ok: false, status: 403, error: "key_revoked" };

  // Barrier: Sandbox keys cannot touch production routes (non-/sandbox/ paths)
  const isSandboxPath = url.pathname.includes("/sandbox/");
  if (k.sandbox && !isSandboxPath) {
    return { ok: false, status: 403, error: "sandbox_scope_violation", detail: "Sandbox keys are restricted to /sandbox/ endpoints" };
  }
  if (!k.sandbox && isSandboxPath) {
    return { ok: false, status: 403, error: "production_scope_violation", detail: "Production keys cannot access sandbox endpoints" };
  }



  const canonical = canonicalString(request.method, url.pathname, timestamp, body);
  if (!safeEq(signature, signCanonical(canonical, String(k["hmac_secret"]))))
    return { ok: false, status: 401, error: "invalid_signature" };

  // Asymmetric non-repudiation layer: the symmetric HMAC proves possession of a
  // shared secret; the ECDSA envelope signature mathematically binds the request
  // to the counterparty's private key (which we never hold).
  if (k["require_asymmetric"] || k["ecdsa_public_key"]) {
    const pub = String(k["ecdsa_public_key"] ?? "");
    const envelope = (request.headers.get("x-m2m-ecdsa") ?? "").trim();
    if (!pub)
      return { ok: false, status: 401, error: "asymmetric_key_not_provisioned" };
    if (!envelope)
      return {
        ok: false,
        status: 401,
        error: "missing_envelope_signature",
        detail: "X-M2M-Ecdsa (base64 DER over the canonical string) is required for this key",
      };
    let valid = false;
    try {
      valid = verify(
        "sha256",
        Buffer.from(canonical),
        pub,
        Buffer.from(envelope, "base64"),
      );
    } catch (e) {
      return {
        ok: false,
        status: 401,
        error: "invalid_envelope_signature",
        detail: (e as Error).message,
      };
    }
    if (!valid) return { ok: false, status: 401, error: "invalid_envelope_signature" };
  }


  // Rate limit + usage log (fail-forward: never blocks on logging errors).
  try {
    const since = new Date(Date.now() - 60_000).toISOString();
    const { count } = await supabaseAdmin
      .from("institutional_api_request_log")
      .select("id", { count: "exact", head: true })
      .eq("api_key_id", k["id"])
      .gte("requested_at", since);
    if ((count ?? 0) >= (k["rate_limit_per_minute"] ?? 120))
      return { ok: false, status: 429, error: "rate_limited" };
    await supabaseAdmin
      .from("institutional_api_request_log")
      .insert({ api_key_id: k["id"], endpoint: url.pathname, http_status: 0 } as never);
    await supabaseAdmin
      .from("institutional_api_keys")
      .update({
        last_used_at: new Date().toISOString(),
        first_intent_at: k["first_intent_at"] ?? new Date().toISOString(),
        onboarding_state:
          k["onboarding_state"] === "PRODUCTION_ENABLED" ? "ACTIVE" : k["onboarding_state"],
      } as never)
      .eq("id", k["id"]);
  } catch (e) {
    console.error("[m2m-hmac] usage log failed", e);
  }

  return {
    ok: true,
    key: {
      id: String(k["id"]),
      label: k["label"] ?? null,
      fund_id: k["fund_id"] ?? null,
      sandbox: Boolean(k["sandbox"]),
      rate_limit_per_minute: k["rate_limit_per_minute"] ?? null,
    },
    body,
    txnId,
    canonical,
  };
}

/** Returns the stored response when this txn id was already executed. */
export async function replayReceipt(apiKeyId: string, txnId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("m2m_idempotency_receipts")
      .select("http_status, response")
      .eq("api_key_id", apiKeyId)
      .eq("client_txn_id", txnId)
      .maybeSingle();
    return (data as { http_status: number; response: unknown } | null) ?? null;
  } catch {
    return null;
  }
}

export async function storeReceipt(input: {
  apiKeyId: string;
  txnId: string;
  endpoint: string;
  requestHash: string;
  status: number;
  response: unknown;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("m2m_idempotency_receipts").insert({
      api_key_id: input.apiKeyId,
      client_txn_id: input.txnId,
      endpoint: input.endpoint,
      request_hash: input.requestHash,
      http_status: input.status,
      response: input.response as never,
    } as never);
  } catch (e) {
    console.error("[m2m-hmac] receipt store failed", e);
  }
}

/** Signs an outbound response body so callers can verify integrity both ways. */
export function signedJson(payload: unknown, status: number, secret: string | null) {
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "X-Asset-Fidelity-Watermark": sha256Hex(body).slice(0, 16),
    "X-M2M-Environment": secret?.includes("test") || secret?.includes("sandbox") ? "UAT" : "PROD",
    ...M2M_CORS,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-M2M-Timestamp": ts,
  };
  if (secret) headers["X-M2M-Signature"] = signCanonical(`${ts}\n${sha256Hex(body)}`, secret);
  return new Response(body, { status, headers });
}
