// Reach Loop entrypoint — syndicate freshly dispatched assets to buyers.
// POST /api/public/hooks/dispatch            → sweep all un-syndicated dispatched assets
// POST /api/public/hooks/dispatch { deal_id } → syndicate one asset immediately
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/dispatch")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, hint: "POST to syndicate dispatched assets to buyers" }),
      POST: async ({ request }) => {
        const started = Date.now();
        try {
          const body = await request.json().catch(() => ({}) as any);
          const dealId: string | undefined = body?.deal_id;
          const limit = Math.min(Number(body?.limit ?? 25), 100);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const cols =
            "id,address,city,state,zip,asset_type,base_contract_price,optimized_acquisition_premium,matched_buyer_id,buyer_tier_stage";

          let assets: any[] = [];
          if (dealId) {
            const { data } = await supabaseAdmin
              .from("closing_pipeline_items")
              .select(cols)
              .eq("id", dealId)
              .limit(1);
            assets = (data ?? []) as any[];
          } else {
            const { data } = await supabaseAdmin
              .from("closing_pipeline_items")
              .select(cols)
              .eq("status", "Webhook_Dispatched")
              .is("syndicated_at", null)
              .is("cleared_at", null)
              .order("optimized_acquisition_premium", { ascending: false })
              .limit(limit);
            assets = (data ?? []) as any[];
          }

          const { syndicateAsset } = await import("@/lib/syndication.server");
          const { buildDealDeck } = await import("@/lib/institutional.server");
          const { syndicateToFunds } = await import("@/lib/fund-intake.server");
          const results = [];
          let fundDispatched = 0;
          for (const a of assets) {
            try {
              const r: any = await syndicateAsset(a);
              try {
                const { data: full } = await supabaseAdmin
                  .from("closing_pipeline_items")
                  .select("*")
                  .eq("id", a.id)
                  .maybeSingle();
                const fund = await syndicateToFunds(buildDealDeck((full ?? a) as any), a.id);
                fundDispatched += fund.dispatched;
                r.fund_intake = fund;
              } catch (e) {
                console.error("[dispatch] fund intake failed", a.id, e);
              }
              results.push(r);
            } catch (e) {
              console.error("[dispatch] syndication failed", a.id, e);
            }
          }

          return Response.json({
            ok: true,
            syndicated: results.length,
            fund_intake_dispatched: fundDispatched,
            results,
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
