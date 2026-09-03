// Portfolio Aggregator — group INSTITUTIONAL_READY assets by ZIP/MSA into
// bulk portfolio packages funds can lock with a single master EMD endpoint.
// POST /api/public/hooks/portfolio-bundle  { min_size?, max_size?, limit? }
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/portfolio-bundle")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, hint: "POST to bundle institutional-ready assets by ZIP" }),
      POST: async ({ request }) => {
        const started = Date.now();
        try {
          const body = await request.json().catch(() => ({}) as any);
          const minSize = Math.max(2, Number(body?.min_size ?? 5));
          const maxSize = Math.min(50, Number(body?.max_size ?? 20));
          const limit = Math.min(Number(body?.limit ?? 500), 1000);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { estimateValuation, INSTITUTIONAL_TAG } = await import(
            "@/lib/institutional.server"
          );

          const { data } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select(
              "id,zip,city,state,sqft,assessed_value,lien_total,base_contract_price,optimized_acquisition_premium,enrichment_tags,bundle_id",
            )
            .eq("status", "Webhook_Dispatched")
            .is("bundle_id", null)
            .is("cleared_at", null)
            .limit(limit);

          const assets = (data ?? []) as any[];
          const ready = assets.filter((a) => {
            const v = estimateValuation(a);
            return (
              v.institutional_ready ||
              (a.enrichment_tags ?? []).includes(INSTITUTIONAL_TAG)
            );
          });

          const byZip = new Map<string, any[]>();
          for (const a of ready) {
            const k = String(a.zip ?? "unknown");
            byZip.set(k, [...(byZip.get(k) ?? []), a]);
          }

          const bundles: any[] = [];
          for (const [zip, group] of byZip) {
            for (let i = 0; i + minSize <= group.length; i += maxSize) {
              const slice = group.slice(i, i + maxSize);
              if (slice.length < minSize) break;
              const totals = slice.reduce(
                (acc, a) => {
                  const v = estimateValuation(a);
                  acc.base += v.offer_price;
                  acc.fee += Number(a.optimized_acquisition_premium ?? 0);
                  acc.arv += v.arv;
                  return acc;
                },
                { base: 0, fee: 0, arv: 0 },
              );

              try {
                const { data: bundle, error } = await supabaseAdmin
                  .from("bundles")
                  .insert({
                    name: `INSTITUTIONAL PORTFOLIO — ${zip} (${slice.length} doors)`,
                    region_tag: zip,
                    total_base: totals.base,
                    total_fee: totals.fee,
                    total_arv: totals.arv,
                    deal_count: slice.length,
                    status: "Open",
                    institutional_tape: true,
                    criteria: {
                      gate: "INSTITUTIONAL_READY",
                      arv_gate: 0.7,
                      zip,
                      blended_discount_ratio:
                        totals.arv > 0 ? Number((totals.base / totals.arv).toFixed(4)) : null,
                    } as never,
                  } as never)
                  .select("id")
                  .maybeSingle();
                if (error || !bundle) continue;

                const bid = (bundle as any).id as string;
                await supabaseAdmin
                  .from("closing_pipeline_items")
                  .update({ bundle_id: bid } as never)
                  .in(
                    "id",
                    slice.map((a) => a.id),
                  );

                bundles.push({
                  bundle_id: bid,
                  zip,
                  doors: slice.length,
                  total_base: totals.base,
                  total_fee: totals.fee,
                  total_arv: totals.arv,
                  master_emd_lock: `/api/v1/bundles/${bid}/programmatic-lock`,
                });
              } catch (e) {
                console.error("[portfolio-bundle] group failed", zip, e);
              }
            }
          }

          return Response.json({
            ok: true,
            scanned: assets.length,
            institutional_ready: ready.length,
            bundles_created: bundles.length,
            bundles,
            latency_ms: Date.now() - started,
          });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
