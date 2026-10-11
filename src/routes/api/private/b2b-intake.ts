import { createFileRoute } from "@tanstack/react-router";

const TARGET = "https://midneoocykeoquxkjkrg.supabase.co/functions/v1/asset-nav-b2b-debt-intake-v1";
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

async function signBridgeBody(body: Uint8Array, privateKeyB64: string) {
  const digest = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", body)));
  const timestamp = String(Date.now());
  const message = new TextEncoder().encode(["v1", timestamp, "POST", TARGET_FUNCTION_SLUG, digest].join("\\n"));
  const privateKey = await crypto.subtle.importKey("pkcs8", decodeBase64(privateKeyB64), { name: "Ed25519" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, message));
  return { digest, timestamp, signature: encodeBase64(signature) };
}

async function readLimitedBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export const Route = createFileRoute("/api/private/b2b-intake")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("Bearer ") || auth.length < 16) {
          return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
        }
        const token = auth.slice(7);
        const appUrl = process.env.SUPABASE_URL;
        const appKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const bridgePrivateKey = process.env.B2B_INTAKE_BRIDGE_PRIVATE_KEY_B64;
        if (!appUrl || !appKey || !bridgePrivateKey) {
          return Response.json({ error: "B2B_INTAKE_BRIDGE_CONFIGURATION_INCOMPLETE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
        }
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
          return Response.json({ error: "MULTIPART_FORM_DATA_REQUIRED" }, { status: 415, headers: { "Cache-Control": "no-store" } });
        }
        const lengthHeader = request.headers.get("content-length");
        if (lengthHeader !== null) {
          const length = Number(lengthHeader);
          if (!Number.isSafeInteger(length) || length < 1) {
            return Response.json({ error: "INVALID_CONTENT_LENGTH" }, { status: 400, headers: { "Cache-Control": "no-store" } });
          }
          if (length > MAX_BYTES) {
            return Response.json({ error: "REQUEST_SIZE_LIMIT_EXCEEDED" }, { status: 413, headers: { "Cache-Control": "no-store" } });
          }
        }

        try {
          const { createClient } = await import("@supabase/supabase-js");
          const appClient = createClient(appUrl, appKey, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: claimsData, error: claimsError } = await appClient.auth.getClaims(token);
          const userId = claimsData?.claims?.sub;
          if (claimsError || typeof userId !== "string" || !userId) {
            return Response.json({ error: "INVALID_USER_TOKEN" }, { status: 401, headers: { "Cache-Control": "no-store" } });
          }
          const { data: isAdmin, error: roleError } = await appClient.rpc("has_role", {
            _user_id: userId,
            _role: "admin",
          });
          if (roleError || isAdmin !== true) {
            return Response.json({ error: "ADMIN_ROLE_REQUIRED" }, { status: 403, headers: { "Cache-Control": "no-store" } });
          }

          const rawBody = await readLimitedBody(request);
          if (!rawBody) {
            return Response.json({ error: "REQUEST_SIZE_LIMIT_EXCEEDED_OR_BODY_MISSING" }, { status: 413, headers: { "Cache-Control": "no-store" } });
          }
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
            body: rawBody,
            cache: "no-store",
            signal: AbortSignal.timeout(30_000),
          });
          return new Response(upstream.body, {
            status: upstream.status,
            headers: {
              "content-type": upstream.headers.get("content-type") ?? "application/json",
              "cache-control": "no-store",
            },
          });
        } catch {
          return Response.json({ error: "B2B_INTAKE_UPSTREAM_UNAVAILABLE" }, { status: 502, headers: { "Cache-Control": "no-store" } });
        }
      },
    },
  },
});
