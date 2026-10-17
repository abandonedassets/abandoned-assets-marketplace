import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const TARGET =
  "https://midneoocykeoquxkjkrg.supabase.co/functions/v1/reel-edge-universal-source-vault-intake-v1";
const MAX_BYTES = 25 * 1024 * 1024;

export const Route = createFileRoute("/api/private/source-vault-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization") ?? "";
        if (!authorization.startsWith("Bearer ")) {
          return Response.json(
            { error: "AUTHENTICATION_REQUIRED" },
            { status: 401, headers: { "Cache-Control": "no-store" } },
          );
        }

        const token = authorization.slice(7).trim();
        const supabaseUrl = process.env.SUPABASE_URL;
        const publishableKey =
          process.env.SUPABASE_PUBLISHABLE_KEY ??
          process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!supabaseUrl || !publishableKey) {
          return Response.json(
            { error: "SUPABASE_AUTH_CONFIGURATION_INCOMPLETE" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }

        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
          return Response.json(
            { error: "MULTIPART_FORM_DATA_REQUIRED" },
            { status: 415, headers: { "Cache-Control": "no-store" } },
          );
        }

        const declaredLength = request.headers.get("content-length");
        if (declaredLength !== null) {
          const length = Number(declaredLength);
          if (!Number.isSafeInteger(length) || length < 1) {
            return Response.json(
              { error: "INVALID_CONTENT_LENGTH" },
              { status: 400, headers: { "Cache-Control": "no-store" } },
            );
          }
          if (length > MAX_BYTES) {
            return Response.json(
              { error: "REQUEST_SIZE_LIMIT_EXCEEDED" },
              { status: 413, headers: { "Cache-Control": "no-store" } },
            );
          }
        }

        try {
          const authClient = createClient(supabaseUrl, publishableKey, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data, error } = await authClient.auth.getClaims(token);
          if (error || typeof data?.claims?.sub !== "string") {
            return Response.json(
              { error: "INVALID_USER_TOKEN" },
              { status: 401, headers: { "Cache-Control": "no-store" } },
            );
          }

          // Bounded buffering protects the server. Keep the caller's JWT so the
          // Source Vault function enforces its own upload permission.
          const reader = request.body?.getReader();
          if (!reader) {
            return Response.json(
              { error: "REQUEST_BODY_REQUIRED" },
              { status: 400, headers: { "Cache-Control": "no-store" } },
            );
          }
          const chunks: Uint8Array[] = [];
          let total = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_BYTES) {
              await reader.cancel();
              return Response.json(
                { error: "REQUEST_SIZE_LIMIT_EXCEEDED" },
                { status: 413, headers: { "Cache-Control": "no-store" } },
              );
            }
            chunks.push(value);
          }
          const body = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.byteLength;
          }

          const upstream = await fetch(TARGET, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: publishableKey,
              "content-type": contentType,
              "cache-control": "no-store",
            },
            body,
            cache: "no-store",
            signal: AbortSignal.timeout(60_000),
          });

          return new Response(upstream.body, {
            status: upstream.status,
            headers: {
              "content-type":
                upstream.headers.get("content-type") ?? "application/json",
              "cache-control": "no-store",
            },
          });
        } catch (error) {
          console.error("[source-vault-ingest] request failed", error);
          return Response.json(
            { error: "SOURCE_VAULT_UPSTREAM_UNAVAILABLE" },
            { status: 502, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
