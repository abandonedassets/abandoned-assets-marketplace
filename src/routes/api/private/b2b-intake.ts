import { createFileRoute } from "@tanstack/react-router";

const TARGET = "https://midneoocykeoquxkjkrg.supabase.co/functions/v1/asset-nav-b2b-debt-intake-v1";
const MAX_BYTES = 16 * 1024 * 1024;

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
        const appKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        const bridgeKey = process.env.B2B_INTAKE_SERVICE_ROLE_KEY;
        if (!appUrl || !appKey || !bridgeKey) {
          return Response.json({ error: "B2B_INTAKE_BRIDGE_CONFIGURATION_INCOMPLETE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
        }
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
          return Response.json({ error: "MULTIPART_FORM_DATA_REQUIRED" }, { status: 415, headers: { "Cache-Control": "no-store" } });
        }
        const lengthHeader = request.headers.get("content-length");
        if (lengthHeader !== null) {
          const length = Number(lengthHeader);
          if (!Number.isSafeInteger(length) || length < 0) {
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
          const upstream = await fetch(TARGET, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${bridgeKey}`,
              apikey: bridgeKey,
              "content-type": contentType,
              "content-length": String(rawBody.byteLength),
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
