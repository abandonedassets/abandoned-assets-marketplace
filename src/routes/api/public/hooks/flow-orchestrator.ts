import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";


const ACTIVE_STATUSES = [
  "New",
  "Under-Review",
  "Seller-Signed",
  "Buyer-Signed",
  "In-Escrow",
] as const;

function log(stage: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ stage, ts: new Date().toISOString(), ...extra }));
}

export const Route = createFileRoute("/api/public/hooks/flow-orchestrator")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.FLOW_CALLBACK_SECRET;
        if (!secret) {
          return new Response("server_misconfigured", { status: 500 });
        }
        const sig = request.headers.get("x-orchestrator-signature") ?? "";
        const raw = await request.text();
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        let provided: Buffer;
        try {
          provided = Buffer.from(sig, "hex");
        } catch {
          return new Response("bad_signature", { status: 401 });
        }
        const exp = Buffer.from(expected, "hex");
        if (provided.length !== exp.length || !timingSafeEqual(provided, exp)) {
          return new Response("invalid_signature", { status: 401 });
        }


        const cycleAt = new Date().toISOString();
        let dispatched = 0;
        let failures = 0;
        let endpointsRescored = 0;


        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          // 1. active inventory
          const { data: items, error: itemsErr } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select(
              "id, zip, beds, baths, sqft, year_built, base_contract_price, optimized_acquisition_premium, status",
            )
            .in("status", [...ACTIVE_STATUSES]);
          if (itemsErr) throw itemsErr;

          // 2. active endpoints
          const { data: endpoints, error: epErr } = await supabaseAdmin
            .from("routing_endpoints")
            .select("id, name, url, priority_score")
            .eq("is_active", true)
            .order("priority_score", { ascending: false });
          if (epErr) throw epErr;

          log("cycle_start", {
            cycleAt,
            items: items?.length ?? 0,
            endpoints: endpoints?.length ?? 0,
          });

          // 3. dispatch loop — fail-forward per record
          for (const ep of endpoints ?? []) {
            for (const item of items ?? []) {
              const t0 = Date.now();
              let status: number | null = null;
              let success = false;
              let errText: string | null = null;
              try {
                const res = await fetch(ep.url, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    tranche: item.id,
                    zip: item.zip,
                    profile: {
                      beds: item.beds,
                      baths: item.baths,
                      sqft: item.sqft,
                      year_built: item.year_built,
                    },
                    base: item.base_contract_price,
                    premium: item.optimized_acquisition_premium,
                    status: item.status,
                  }),
                  signal: AbortSignal.timeout(10_000),
                });
                status = res.status;
                success = res.ok;
              } catch (e) {
                errText = e instanceof Error ? e.message : String(e);
              }
              const latency = Date.now() - t0;
              if (success) dispatched++;
              else failures++;

              try {
                await supabaseAdmin.from("routing_dispatch_log").insert({
                  endpoint_id: ep.id,
                  pipeline_item_id: item.id,
                  http_status: status,
                  latency_ms: latency,
                  success,
                  error_text: errText,
                });
              } catch (e) {
                log("log_insert_failed", { error: String(e) });
              }
            }

            try {
              await supabaseAdmin
                .from("routing_endpoints")
                .update({ last_dispatched_at: new Date().toISOString() })
                .eq("id", ep.id);
            } catch (e) {
              log("endpoint_touch_failed", { endpoint: ep.id, error: String(e) });
            }
          }

          // 4. recompute priority_score over last 72h
          const since = new Date(Date.now() - 72 * 3600_000).toISOString();
          for (const ep of endpoints ?? []) {
            try {
              const { data: logs, error: lErr } = await supabaseAdmin
                .from("routing_dispatch_log")
                .select("success, latency_ms")
                .eq("endpoint_id", ep.id)
                .gte("dispatched_at", since);
              if (lErr) throw lErr;
              const n = logs?.length ?? 0;
              if (n === 0) continue;
              const succ = (logs ?? []).filter((l) => l.success).length;
              const successRate = succ / n;
              const avgLatency =
                (logs ?? []).reduce((s, l) => s + (l.latency_ms ?? 0), 0) / n;
              const latencyTerm = 1 / (1 + avgLatency / 1000); // normalize seconds
              const score =
                Math.round((0.7 * successRate + 0.3 * latencyTerm) * 10000) /
                10000;
              await supabaseAdmin
                .from("routing_endpoints")
                .update({ priority_score: score })
                .eq("id", ep.id);
              endpointsRescored++;
            } catch (e) {
              log("rescore_failed", { endpoint: ep.id, error: String(e) });
            }
          }

          log("cycle_end", {
            cycleAt,
            dispatched,
            failures,
            endpointsRescored,
          });

          return Response.json({
            ok: true,
            cycle_at: cycleAt,
            dispatched,
            failures,
            endpoints_rescored: endpointsRescored,
          });
        } catch (e) {
          log("cycle_fatal", { error: e instanceof Error ? e.message : String(e) });
          return Response.json(
            { ok: false, error: "cycle_failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
