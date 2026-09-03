// POST /api/public/v1/intents — Cryptographic Dark Crossing.
// A fund posts its buying criteria; the payload is sealed with AES-256-GCM
// before it touches storage. We never persist readable intent, so no resting
// order can be front-run, scraped, or inferred from the public tape.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/intents")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { M2M_CORS } = await import("@/lib/m2m-hmac.server");
        return new Response(null, { status: 204, headers: M2M_CORS });
      },

      // Status only — counts, never criteria.
      GET: async ({ request }) => {
        const { verifySignedRequest, M2M_CORS } = await import("@/lib/m2m-hmac.server");
        const v = await verifySignedRequest(request);
        if (!v.ok)
          return Response.json(
            { ok: false, error: v.error, detail: v.detail ?? null },
            { status: v.status, headers: M2M_CORS },
          );
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("dark_cross_intents")
          .select("id, status, crossed_deal_id, crossed_at, expires_at, created_at")
          .eq("api_key_id", v.key.id)
          .order("created_at", { ascending: false })
          .limit(100);
        return Response.json(
          { ok: true, intents: data ?? [] },
          { headers: M2M_CORS },
        );
      },

      POST: async ({ request }) => {
        const t0 = Date.now();
        const { verifySignedRequest, M2M_CORS } = await import("@/lib/m2m-hmac.server");
        const { logInbound } = await import("@/lib/m2m-algo.server");
        const endpoint = new URL(request.url).pathname;
        const cloned = request.clone();

        const v = await verifySignedRequest(request, { requireTxnId: true });
        if (!v.ok) {
          await logInbound({
            request: cloned,
            endpoint,
            key: request.headers.get("x-m2m-key-id") ?? undefined,
            status: v.status,
            latencyMs: Date.now() - t0,
            bodyPreview: "[sealed]",
          });
          return Response.json(
            { ok: false, error: v.error, detail: v.detail ?? null },
            { status: v.status, headers: M2M_CORS },
          );
        }

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(v.body || "{}") as Record<string, unknown>;
        } catch {
          return Response.json({ ok: false, error: "invalid_json" }, { status: 400, headers: M2M_CORS });
        }

        const { postIntent } = await import("@/lib/dark-cross.server");
        const res = await postIntent({
          apiKeyId: v.key.id,
          boxId: (parsed["box_id"] as string) ?? null,
          ttlHours: Number(parsed["ttl_hours"] ?? 168),
          intent: {
            asset_classes: toArr(parsed["asset_classes"]),
            states: toArr(parsed["states"]),
            zips: toArr(parsed["zips"]),
            min_assignment_fee: num(parsed["min_assignment_fee"]),
            min_price: num(parsed["min_price"]),
            max_price: num(parsed["max_price"]),
            min_arv_ratio: num(parsed["min_arv_ratio"]),
            max_notional: num(parsed["max_notional"]),
            title_clean_only: parsed["title_clean_only"] === true,
            auto_execute: parsed["auto_execute"] !== false,
          },
        });

        // Never log the payload — the point of dark crossing is that we can't
        // leak what we never wrote down.
        await logInbound({
          request: cloned,
          endpoint,
          key: v.key.label ?? undefined,
          authorized: true,
          boxLabel: v.key.label,
          status: res.ok ? 202 : 500,
          latencyMs: Date.now() - t0,
          bodyPreview: "[sealed intent]",
        });

        return Response.json(
          res.ok
            ? {
                ok: true,
                intent_id: res.intent_id,
                sealed: "aes-256-gcm",
                expires_at: res.expires_at,
                note: "Criteria are encrypted at rest. Crossing runs blind on the 60s cycle; a match returns via GET /api/public/v1/intents.",
              }
            : { ok: false, error: res.error },
          { status: res.ok ? 202 : 500, headers: M2M_CORS },
        );
      },
    },
  },
});

function toArr(v: unknown) {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : undefined;
}
function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}
