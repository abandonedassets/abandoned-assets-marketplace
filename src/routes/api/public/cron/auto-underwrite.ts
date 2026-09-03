// Autonomous cron underwriter. Scans Pending-Underwriting deals, derives ARV +
// repairs with zero-key data, writes them back (DB trigger recomputes the fee),
// and publishes anything with a positive fee to the live tape / marketplace.
// Fail-forward: one bad row never stalls the batch; always returns 200.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/auto-underwrite")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, hint: "POST to run the auto-underwriter batch" }),
      POST: async ({ request }) => {
        const started = Date.now();
        let scanned = 0;
        let underwritten = 0;
        let published = 0;
        let skipped = 0;
        try {
          const body = (await request.json().catch(() => ({}))) as { limit?: number };
          const limit = Math.min(200, Math.max(1, Number(body?.limit) || 50));

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { underwrite, computeFee } = await import("@/lib/underwrite.server");
          const { loadActiveBuyBoxes, evaluateAsset } = await import("@/lib/buybox.server");
          const alpha = await import("@/lib/alpha-score.server");
          const boxes = await loadActiveBuyBoxes();
          const regime = await alpha.loadRegime();
          const weights = await alpha.loadSubmarketWeights(null);


          const { data: rows, error } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select(
              "id, zip, sqft, year_built, beds, baths, has_garage, hoa_monthly, acreage, assessed_value, estimated_repairs, base_contract_price, status",
            )
            .eq("status", "Pending-Underwriting")
            // Rotate by staleness so the same no-margin rows aren't rescanned
            // every run while the tail of the queue never gets touched.
            .order("updated_at", { ascending: true })
            .limit(limit);

          if (error) {
            return Response.json({ ok: false, error: error.message }, { status: 200 });
          }

          for (const r of (rows ?? []) as Record<string, any>[]) {
            scanned++;
            try {
              const res = await underwrite(r as any);
              if (!res.arv) {
                console.error("[auto-underwrite] no arv", r.id, r.zip, r.base_contract_price);
                skipped++;
                continue;
              }

              const offer = Number(r.base_contract_price) || 0;
              const repairs = res.repairs ?? 0;
              const fee = computeFee(res.arv, repairs, offer);

              const bb = evaluateAsset(
                {
                  ...(r as Record<string, unknown>),
                  assessed_value: res.arv,
                  estimated_repairs: repairs,
                  optimized_acquisition_premium: fee,
                } as never,
                boxes,
              );

              const scoreInputs = {
                ...(r as Record<string, unknown>),
                assessed_value: res.arv,
                estimated_repairs: repairs,
                optimized_acquisition_premium: fee,
                estimated_cap_rate: bb.estimated_cap_rate,
              } as never;
              const s = alpha.compositeScore(
                scoreInputs,
                regime,
                weights[String(r.zip ?? "").slice(0, 5)] ?? 1,
              );
              const risk = alpha.monteCarlo(scoreInputs, String(r.id));

              const patch: Record<string, unknown> = {
                assessed_value: res.arv,
                estimated_repairs: repairs,
                estimated_cap_rate: bb.estimated_cap_rate,
                matched_fund_ids: bb.matched_fund_ids,
                composite_score: s.composite_score,
                risk_var_95: risk.risk_var_95,
                uw_ci_low: risk.uw_ci_low,
                uw_ci_high: risk.uw_ci_high,
              };

              if (fee > 0) {
                patch['status'] = "Webhook_Dispatched";
                patch['optimized_acquisition_premium'] = fee;
              } else {
                // No spread at the asking price. Instead of parking the row
                // forever, publish the maximum price that still clears a
                // $5k assignment fee so the reverse-strike engine can counter.
                const MIN_FEE = 5000;
                const maxViableOffer = Math.max(0, Math.round(res.arv * 0.7 - repairs - MIN_FEE));
                patch['absolute_floor_price'] = maxViableOffer;
                patch['optimized_acquisition_premium'] = 0;
              }


              const { error: upErr } = await supabaseAdmin
                .from("closing_pipeline_items")
                .update(patch as never)
                .eq("id", r.id);

              if (upErr) {
                console.error("[auto-underwrite] update blocked", r.id, upErr.message);
                skipped++;
                continue;
              }

              underwritten++;
              if (fee > 0) published++;
            } catch (e) {
              skipped++;
              console.error("[auto-underwrite] row failed", r.id, (e as Error).message);
            }
          }

          try {
            await supabaseAdmin.from("ingest_runs").insert({
              source: "auto-underwrite",
              status: "ok",
              total_rows: scanned,
              inserted: published,
              deduped: underwritten,
              dlq: skipped,
              note: `${published} published in ${Date.now() - started}ms`,
            } as never);
          } catch {
            /* fail-forward */
          }

          return Response.json({
            ok: true,
            scanned,
            underwritten,
            published,
            skipped,
            ms: Date.now() - started,
          });
        } catch (e) {
          console.error("[auto-underwrite] unhandled", e);
          return Response.json(
            { ok: false, error: (e as Error).message, scanned, underwritten, published },
            { status: 200 },
          );
        }
      },
    },
  },
});
