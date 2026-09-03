// POST /api/v1/deals/underwrite — instant institutional underwrite / backtest.
// Funds paste a raw T12 + rent roll (or a historical closed deal) and get back a
// valuation, composite alpha score, Monte Carlo VaR, and deterministic distress
// triggers in one round trip. Stateless by default (?persist=1 to write a lead).
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export const Route = createFileRoute("/api/v1/deals/underwrite")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const started = Date.now();
        try {
          const auth = request.headers.get("authorization") ?? "";
          const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
          if (!bearer)
            return Response.json({ error: "unauthorized" }, { status: 403, headers: CORS });

          const { authorizeInstitutionalKey } = await import("@/lib/m2m.server");
          const authed = await authorizeInstitutionalKey(bearer);
          if (!authed.ok)
            return Response.json({ error: authed.error }, { status: authed.status, headers: CORS });

          const body = (await request.json().catch(() => ({}))) as Record<string, any>;
          const p = (body['property'] ?? body) as Record<string, any>;

          const { normalizeT12, distressTriggers } = await import("@/lib/t12.server");
          const alpha = await import("@/lib/alpha-score.server");

          const t12 = normalizeT12((body['t12'] ?? body['financials'] ?? {}) as never);
          const regime = await alpha.loadRegime();
          const hurdle = alpha.marketHurdle(regime);

          const offer = Number(p['offer_price'] ?? p['base_contract_price']) || 0;
          const repairs = Number(p['estimated_repairs']) || 0;
          // Value the asset off real NOI when present, else fall back to supplied ARV.
          const capForValue = Number(p['exit_cap_rate']) || hurdle;
          const noiValue = t12.noi > 0 ? t12.valuation_at_cap(capForValue) : 0;
          const arv = noiValue || Number(p['arv'] ?? p['assessed_value']) || 0;

          const totalBasis = offer + repairs;
          const capRate = totalBasis > 0 && t12.noi > 0 ? Number((t12.noi / totalBasis).toFixed(4)) : null;

          const { computeFee } = await import("@/lib/underwrite.server");
          const fee = arv > 0 ? computeFee(arv, repairs, offer) : 0;

          const weights = await alpha.loadSubmarketWeights(null);
          const zip = String(p['zip'] ?? "").slice(0, 5);
          const scoreInput = {
            zip,
            assessed_value: arv,
            estimated_repairs: repairs,
            base_contract_price: offer,
            optimized_acquisition_premium: fee,
            estimated_cap_rate: capRate ?? (Number(p['cap_rate']) || 0),
            year_built: Number(p['year_built']) || null,
            sqft: Number(p['sqft']) || null,
            days_owned: Number(p['days_owned']) || null,
            lien_total: Number(p['lien_total']) || null,
            annual_property_tax: Number(p['annual_property_tax']) || null,
            confidence_score: Number(p['confidence_score']) || 70,
          };

          const rank = alpha.compositeScore(scoreInput, regime, weights[zip] ?? 1);
          const seed = String(p['external_id'] ?? p['address'] ?? zip ?? "backtest");
          const risk = alpha.monteCarlo(scoreInput, seed, 10000);
          const flags = distressTriggers({
            t12,
            lien_total: scoreInput.lien_total,
            annual_property_tax: scoreInput.annual_property_tax,
            assessed_value: arv,
            days_owned: scoreInput.days_owned,
            estimated_cap_rate: scoreInput.estimated_cap_rate,
          });

          let persisted_deal_id: string | null = null;
          if (new URL(request.url).searchParams.get("persist") === "1" && zip) {
            try {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const { data } = await supabaseAdmin
                .from("closing_pipeline_items")
                .insert({
                  zip,
                  address: p['address'] ?? null,
                  city: p['city'] ?? null,
                  state: p['state'] ?? null,
                  county: p['county'] ?? null,
                  apn: p['apn'] ?? null,
                  asset_type: p['asset_type'] ?? "MF",
                  base_contract_price: offer,
                  estimated_repairs: repairs,
                  assessed_value: arv,
                  optimized_acquisition_premium: fee,
                  estimated_cap_rate: capRate,
                  source: "institutional_underwrite_api",
                  status: "Pending-Underwriting",
                } as never)
                .select("id")
                .maybeSingle();
              persisted_deal_id = (data as { id?: string } | null)?.id ?? null;
            } catch (e) {
              console.error("[underwrite] persist failed", (e as Error).message);
            }
          }

          return Response.json(
            {
              ok: true,
              latency_ms: Date.now() - started,
              market_regime: regime.regime,
              hurdle_cap_rate: Number(hurdle.toFixed(4)),
              underwriting: {
                units: t12.units,
                gross_potential_rent: t12.gross_potential_rent,
                vacancy_loss: t12.vacancy_loss,
                economic_vacancy_pct: t12.economic_vacancy_pct,
                effective_gross_income: t12.effective_gross_income,
                operating_expenses: t12.operating_expenses,
                opex_ratio: t12.opex_ratio,
                capex_reserve: t12.capex_reserve,
                noi: t12.noi,
                annual_debt_service: t12.annual_debt_service,
                dscr: t12.dscr,
              },
              valuation: {
                stabilized_value: arv,
                exit_cap_used: Number(capForValue.toFixed(4)),
                offer_price: offer,
                estimated_repairs: repairs,
                assignment_fee: fee,
                total_to_buyer: offer + fee,
                going_in_cap_rate: capRate,
                yield_delta: rank.yield_delta,
                spread_to_value: arv > 0 ? Math.round(arv - (offer + fee + repairs)) : null,
              },
              risk: {
                risk_var_95: risk.risk_var_95,
                uw_ci_low: risk.uw_ci_low,
                uw_ci_high: risk.uw_ci_high,
                mc_iterations: risk.iterations,
              },
              distress: flags,
              composite_score: rank.composite_score,
              investment_committee_ready: rank.composite_score >= 80 && (capRate ?? 0) >= hurdle,
              persisted_deal_id,
            },
            { headers: { ...CORS, "Cache-Control": "no-store" } },
          );
        } catch (e) {
          console.error("[deals/underwrite] failed", e);
          return Response.json({ error: "unhandled" }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
