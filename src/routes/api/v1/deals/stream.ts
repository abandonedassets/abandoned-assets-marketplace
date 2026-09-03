// GET /api/v1/deals/stream — Bearer-authenticated raw verified deal feed (NDJSON or JSON).
// Query: ?zip=&asset_type=&min_fee=&limit=&format=ndjson
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export const Route = createFileRoute("/api/v1/deals/stream")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        try {
          const auth = request.headers.get("authorization") ?? "";
          const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
          if (!bearer)
            return Response.json({ error: "unauthorized" }, { status: 403, headers: CORS });

          const { authorizeInstitutionalKey } = await import("@/lib/m2m.server");
          const authed = await authorizeInstitutionalKey(bearer);
          if (!authed.ok)
            return Response.json(
              { error: authed.error },
              { status: authed.status, headers: CORS },
            );

          const url = new URL(request.url);
          const zip = url.searchParams.get("zip");
          const assetType = url.searchParams.get("asset_type");
          const minFee = Number(url.searchParams.get("min_fee") ?? 0) || 0;
          const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") ?? 250)));
          const ndjson = url.searchParams.get("format") === "ndjson";

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Strict buy-box scoping: a key bound to a fund only ever sees that
          // fund's 100%-matched inventory. Unbound keys see the full tape.
          const { data: keyRow } = await supabaseAdmin
            .from("institutional_api_keys")
            .select("fund_id")
            .eq("id", authed.key.id)
            .maybeSingle();
          const fundId = (keyRow as { fund_id?: string | null } | null)?.fund_id ?? null;

          let q = supabaseAdmin
            .from("closing_pipeline_items")
            .select("*")
            .eq("status", "Webhook_Dispatched")
            .gte("optimized_acquisition_premium", minFee)
            .order("composite_score", { ascending: false, nullsFirst: false })
            .order("optimized_acquisition_premium", { ascending: false })
            .limit(limit);

          if (fundId) q = q.contains("matched_fund_ids", [fundId]);
          if (zip) q = q.eq("zip", zip);
          if (assetType) q = q.eq("asset_type", assetType);

          const { data: rows, error } = await q;
          if (error)
            return Response.json({ error: "query_failed" }, { status: 500, headers: CORS });

          const trust = await import("@/lib/trust-metrics.server");
          const { vdrUrl } = await import("@/lib/vdr.server");
          const alpha = await import("@/lib/alpha-score.server");
          const regime = await alpha.loadRegime();
          const weights = await alpha.loadSubmarketWeights(fundId);
          const origin = url.origin;

          const out = await Promise.all(
            (rows ?? []).map(async (r: Record<string, any>) => {
              const offer = Number(r.base_contract_price) || 0;
              const repairs = Number(r.estimated_repairs) || 0;
              const arv = Number(r.assessed_value) || 0;
              const fee = Number(r.optimized_acquisition_premium) || 0;
              let purity = null as number | null;
              let fema = true;
              let tax = 0;
              try {
                purity = trust.titlePurityScore(r as any)?.title_purity_score ?? null;
                fema = trust.femaClearance(r as any)?.fema_zone_clear !== false;
                tax = trust.projectedPostSaleTax(r as any)?.projected_post_sale_tax ?? 0;
              } catch {
                /* fail-forward */
              }
              let vdr: string | null = null;
              try {
                vdr = await vdrUrl(origin, r.id);
              } catch {
                /* optional */
              }
              const rank = alpha.compositeScore(
                r as never,
                regime,
                weights[String(r.zip ?? "").slice(0, 5)] ?? 1,
              );
              const risk =
                r.risk_var_95 == null
                  ? alpha.monteCarlo(r as never, String(r.id), 2000)
                  : {
                      risk_var_95: Number(r.risk_var_95),
                      uw_ci_low: Number(r.uw_ci_low ?? 0),
                      uw_ci_high: Number(r.uw_ci_high ?? 0),
                      iterations: 10000,
                    };
              return {

                deal_id: r.id,
                // Blind Asset Protocol: street address, city and APN stay
                // sealed until the buyer holds a live lock.
                address: null,
                address_masked: true,
                zip: r.zip,
                beds: (r as any).beds ?? null,
                baths: (r as any).baths ?? null,
                sqft: (r as any).sqft ?? null,
                city: null,
                state: r.state ?? null,
                county: r.county ?? null,
                apn: null,
                asset_type: r.asset_type ?? null,
                arv,
                estimated_repairs: repairs,
                offer_price: offer,
                assignment_fee: fee,
                total_to_buyer: offer + fee,
                spread: arv > 0 ? Number((arv * 0.7 - repairs - offer).toFixed(2)) : null,
                title_purity_score: purity,
                title_status: r.title_status ?? null,
                fema_zone_clear: fema,
                projected_post_sale_tax: Math.round(tax),
                estimated_cap_rate: r.estimated_cap_rate ?? null,
                matched_fund_ids: r.matched_fund_ids ?? [],
                confidence_score: r.confidence_score ?? null,
                liquidity_bucket: r.liquidity_bucket ?? null,
                contract_state: r.contract_state ?? "UNSENT",
                verification_status: r.verification_status ?? null,
                composite_score: rank.composite_score,
                yield_delta: rank.yield_delta,
                market_regime: regime.regime,
                risk_var_95: risk.risk_var_95,
                uw_ci_low: risk.uw_ci_low,
                uw_ci_high: risk.uw_ci_high,
                mc_iterations: risk.iterations,
                vdr_url: vdr,
                buy_link: `${origin}/api/public/checkout/create-session?deal=${r.id}`,
                marketplace_url: `${origin}/marketplace`,
                feedback_url: `${origin}/api/v1/deals/feedback`,
                updated_at: r.updated_at,
              };
            }),
          );
          out.sort((a, b) => b.composite_score - a.composite_score);



          if (ndjson) {
            return new Response(out.map((o) => JSON.stringify(o)).join("\n") + "\n", {
              headers: {
                ...CORS,
                "Content-Type": "application/x-ndjson",
                "Cache-Control": "no-store",
              },
            });
          }
          return Response.json(
            { count: out.length, generated_at: new Date().toISOString(), deals: out },
            { headers: { ...CORS, "Cache-Control": "no-store" } },
          );
        } catch (e) {
          console.error("[deals/stream] failed", e);
          return Response.json({ error: "unhandled" }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
