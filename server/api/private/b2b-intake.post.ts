import { createClient } from "@supabase/supabase-js";

const TARGET =
  "https://midneoocykeoquxkjkrg.supabase.co/functions/v1/asset-nav-b2b-debt-intake-v1";
const TARGET_API_KEY = "sb_publishable_wH2in1zbqd1jNggdbNT5iQ_1BiDXzLd";
const TARGET_FUNCTION_SLUG = "asset-nav-b2b-debt-intake-v1";
const MAX_BYTES = 16 * 1024 * 1024;

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

async function signBridgeBody(body: Uint8Array, privateKeyB64: string) {
  const digest = toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", asArrayBuffer(body))),
  );
  const timestamp = String(Date.now());
  const message = new TextEncoder().encode(
    ["v1", timestamp, "POST", TARGET_FUNCTION_SLUG, digest].join("\n"),
  );
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    asArrayBuffer(decodeBase64(privateKeyB64)),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("Ed25519", privateKey, asArrayBuffer(message)),
  );
  return { digest, timestamp, signature: encodeBase64(signature) };
}

function jsonError(event: any, status: number, error: string) {
  setResponseStatus(event, status);
  setHeader(event, "content-type", "application/json; charset=utf-8");
  setHeader(event, "cache-control", "no-store");
  return { error };
}

export default defineEventHandler(async (event) => {
  if (getMethod(event) !== "POST") {
    setHeader(event, "allow", "POST");
    return jsonError(event, 405, "METHOD_NOT_ALLOWED");
  }

  const authorization = getHeader(event, "authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match?.[1]) return jsonError(event, 401, "AUTHENTICATION_REQUIRED");

  const appUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const appAnonKey =
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const bridgePrivateKey = process.env.B2B_INTAKE_BRIDGE_PRIVATE_KEY_B64;
  if (!appUrl || !appAnonKey || !bridgePrivateKey) {
    return jsonError(event, 503, "B2B_INTAKE_BRIDGE_CONFIGURATION_INCOMPLETE");
  }

  const appClient = createClient(appUrl, appAnonKey, {
    global: { headers: { Authorization: `Bearer ${match[1]}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await appClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonError(event, 401, "INVALID_USER_TOKEN");
  }
  const { data: isAdmin, error: roleError } = await appClient.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "admin",
  });
  if (roleError || isAdmin !== true) {
    return jsonError(event, 403, "ADMIN_ROLE_REQUIRED");
  }

  const contentType = getHeader(event, "content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return jsonError(event, 415, "MULTIPART_FORM_DATA_REQUIRED");
  }

  const lengthHeader = getHeader(event, "content-length");
  if (lengthHeader !== undefined) {
    if (!/^\d+$/.test(lengthHeader)) {
      return jsonError(event, 400, "INVALID_CONTENT_LENGTH");
    }
    const declaredLength = Number(lengthHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 1) {
      return jsonError(event, 400, "INVALID_CONTENT_LENGTH");
    }
    if (declaredLength > MAX_BYTES) {
      return jsonError(event, 413, "REQUEST_SIZE_LIMIT_EXCEEDED");
    }
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of event.node.req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_BYTES) {
        return jsonError(event, 413, "REQUEST_SIZE_LIMIT_EXCEEDED");
      }
      chunks.push(bytes);
    }
  } catch {
    return jsonError(event, 400, "REQUEST_BODY_UNREADABLE");
  }

  if (totalBytes === 0) return jsonError(event, 400, "REQUEST_BODY_REQUIRED");
  const rawBody = Buffer.concat(chunks, totalBytes);
  if (lengthHeader !== undefined && Number(lengthHeader) !== rawBody.byteLength) {
    return jsonError(event, 400, "CONTENT_LENGTH_MISMATCH");
  }

  try {
    const signed = await signBridgeBody(rawBody, bridgePrivateKey);
    const upstream = await fetch(TARGET, {
      method: "POST",
      headers: {
        Authorization: "Bearer b2b-bridge-v1",
        apikey: TARGET_API_KEY,
        "content-type": contentType,
        "content-length": String(rawBody.byteLength),
        "x-b2b-timestamp": signed.timestamp,
        "x-b2b-body-sha256": signed.digest,
        "x-b2b-signature": signed.signature,
      },
      body: asArrayBuffer(rawBody),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    setResponseStatus(event, upstream.status);
    setHeader(
      event,
      "content-type",
      upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    );
    setHeader(event, "cache-control", "no-store");
    return await upstream.text();
  } catch {
    return jsonError(event, 502, "B2B_INTAKE_UPSTREAM_UNAVAILABLE");
  }
});
