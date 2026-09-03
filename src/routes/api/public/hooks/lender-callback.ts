import { createFileRoute } from "@tanstack/react-router";

/**
 * Idempotent inbound lender decisioning receiver.
 * Auth: shared bearer LENDER_CALLBACK_TOKEN (per-lender bearer is outbound only).
 * Duplicate transaction_ids are acknowledged and ignored.
 */
export const Route = createFileRoute("/api/public/hooks/lender-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["LENDER_CALLBACK_TOKEN"];
        const auth = request.headers.get("authorization") ?? "";
        if (!expected || auth !== `Bearer ${expected}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const txId = String(body["transaction_id"] ?? "").trim();
        const lender = String(body["lender"] ?? "UNKNOWN").slice(0, 120);
        const state = String(body["state"] ?? body["status"] ?? "").toUpperCase();
        const ALLOWED = ["DISPATCHED", "UNDERWRITING", "APPROVED", "DECLINED"];
        if (!txId || !ALLOWED.includes(state)) {
          return Response.json({ error: "transaction_id and valid state required" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { error: dupe } = await supabaseAdmin
          .from("webhook_replay_guard")
          .insert({ event_id: `lender:${txId}:${state}`, source: "LENDER_CALLBACK" } as never);
        if (dupe) return Response.json({ ok: true, duplicate: true });

        await supabaseAdmin.from("dispatch_logs").insert({
          channel: "LENDER_CALLBACK",
          endpoint_name: lender,
          endpoint_url: "inbound",
          http_status: 200,
          ok: state !== "DECLINED",
          latency_ms: 0,
          detail: `${state} :: tx ${txId}`,
          payload: body as never,
        } as never);

        return Response.json({ ok: true, state, transaction_id: txId });
      },
    },
  },
});
