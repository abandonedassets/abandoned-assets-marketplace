import { createFileRoute } from "@tanstack/react-router";
import { createHash, createHmac } from "crypto";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const StrikeSchema = z.object({
  deal_id: z.string().uuid(),
  idempotency_key: z.string().min(8).max(128).optional(),
});

function hashKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export const Route = createFileRoute("/api/v1/institutional/strike")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const t0 = Date.now();
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // --- Auth ---
        const auth = request.headers.get("authorization") ?? "";
        const bearer = auth.toLowerCase().startsWith("bearer ")
          ? auth.slice(7).trim()
          : "";
        if (!bearer) {
          return Response.json(
            { error: "unauthorized" },
            { status: 403, headers: CORS },
          );
        }
        const { data: keyRow } = await supabaseAdmin
          .from("institutional_api_keys")
          .select("id, is_active, label")
          .eq("key_hash", hashKey(bearer))
          .maybeSingle();
        if (!keyRow || !keyRow.is_active) {
          return Response.json(
            { error: "unauthorized" },
            { status: 403, headers: CORS },
          );
        }

        // --- Validate input ---
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { error: "invalid_json" },
            { status: 400, headers: CORS },
          );
        }
        const parsed = StrikeSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "invalid_input", details: parsed.error.flatten() },
            { status: 400, headers: CORS },
          );
        }
        const { deal_id, idempotency_key } = parsed.data;

        // --- Idempotency replay protection ---
        if (idempotency_key) {
          const { data: prior } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select(
              "id, status, locked_at, base_contract_price, optimized_acquisition_premium, zip",
            )
            .eq("idempotency_key", idempotency_key)
            .maybeSingle();
          if (prior) {
            return Response.json(
              {
                status: "already_locked",
                deal_id: prior.id,
                locked_at: prior.locked_at,
              },
              { status: 200, headers: CORS },
            );
          }
        }

        // --- 400ms cryptographic row-lock ---
        const { data: locked, error: lockErr } = await supabaseAdmin.rpc(
          "strike_lock_deal",
          { _deal_id: deal_id, _key_id: keyRow.id },
        );

        if (lockErr) {
          const msg = lockErr.message || "";
          if (msg.includes("ALREADY_CLEARED") || msg.includes("could not obtain lock")) {
            return Response.json(
              { error: "conflict", message: "Asset Already Cleared" },
              { status: 409, headers: CORS },
            );
          }
          if (msg.includes("NOT_FOUND")) {
            return Response.json(
              { error: "not_found" },
              { status: 404, headers: CORS },
            );
          }
          return Response.json(
            { error: "lock_failed", message: msg },
            { status: 500, headers: CORS },
          );
        }

        const row = Array.isArray(locked) ? locked[0] : locked;
        const base = Number(row?.base_contract_price ?? 0);
        const fee = Number(row?.optimized_acquisition_premium ?? 0);

        // Persist idempotency key after successful lock (best-effort)
        if (idempotency_key) {
          await supabaseAdmin
            .from("closing_pipeline_items")
            .update({ idempotency_key })
            .eq("id", deal_id);
        }

        // --- Autonomous Title Dispatch (fail-forward) ---
        const payload = {
          deal_id,
          zip: row?.zip,
          base_contract_price: base,
          assignment_fee: fee,
          total_acquisition_cost: base + fee,
          buyer_api_key_id: keyRow.id,
          buyer_label: keyRow.label,
          locked_at: row?.locked_at,
          dispatched_at: new Date().toISOString(),
        };

        // Upsert title package
        await supabaseAdmin
          .from("title_packages")
          .upsert(
            {
              pipeline_item_id: deal_id,
              package_status: "Sent",
              payload: payload as any,
            },
            { onConflict: "pipeline_item_id" },
          );

        // Execution Probability Routing — latency-weighted, fill-rate-weighted.
        // Endpoints with no history fall back to their static priority_score.
        const { data: endpointCandidates } = await supabaseAdmin
          .from("routing_endpoints")
          .select(
            "id, url, priority_score, avg_settlement_latency_ms, fill_count, bust_count",
          )
          .eq("is_active", true);

        let endpoint: { id: string; url: string } | null = null;
        if (endpointCandidates && endpointCandidates.length > 0) {
          const scored = endpointCandidates
            .map((e: any) => {
              const priority = Number(e.priority_score ?? 0) || 1;
              const fills = Number(e.fill_count ?? 0);
              const busts = Number(e.bust_count ?? 0);
              const avgMin =
                e.avg_settlement_latency_ms != null
                  ? Number(e.avg_settlement_latency_ms) / 60000
                  : null;
              const latencyMul = avgMin == null ? 1 : 1 / (1 + avgMin / 60);
              const fillMul =
                fills + busts === 0 ? 1 : fills / (fills + busts + 1);
              return { e, score: priority * latencyMul * fillMul };
            })
            .sort((a, b) => b.score - a.score);
          const top = scored[0]?.e;
          if (top) endpoint = { id: top.id, url: top.url };
        }

        let escrow_status: string = "dispatched_no_endpoint";
        if (endpoint?.url) {
          const secret = process.env.FLOW_CALLBACK_SECRET ?? "";
          const bodyStr = JSON.stringify(payload);
          const sig = secret
            ? createHmac("sha256", secret).update(bodyStr).digest("hex")
            : "";
          const dT0 = Date.now();
          try {
            const resp = await fetch(endpoint.url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-title-signature": sig,
              },
              body: bodyStr,
              signal: AbortSignal.timeout(8000),
            });
            await supabaseAdmin.from("routing_dispatch_log").insert({
              endpoint_id: endpoint.id,
              pipeline_item_id: deal_id,
              http_status: resp.status,
              latency_ms: Date.now() - dT0,
              success: resp.ok,
              error_text: resp.ok ? null : `HTTP ${resp.status}`,
            });
            await supabaseAdmin
              .from("routing_endpoints")
              .update({ last_dispatched_at: new Date().toISOString() })
              .eq("id", endpoint.id);
            escrow_status = resp.ok ? "title_dispatched" : "title_dispatch_failed";
          } catch (e: any) {
            await supabaseAdmin.from("routing_dispatch_log").insert({
              endpoint_id: endpoint.id,
              pipeline_item_id: deal_id,
              http_status: null,
              latency_ms: Date.now() - dT0,
              success: false,
              error_text: String(e?.message ?? e).slice(0, 500),
            });
            escrow_status = "title_dispatch_failed";
          }
        }

        await supabaseAdmin
          .from("closing_pipeline_items")
          .update({ escrow_status })
          .eq("id", deal_id);

        return Response.json(
          {
            status: "locked",
            deal_id,
            locked_at: row?.locked_at,
            assignment_fee: fee,
            escrow_status,
            elapsed_ms: Date.now() - t0,
          },
          { status: 200, headers: CORS },
        );
      },
    },
  },
});
