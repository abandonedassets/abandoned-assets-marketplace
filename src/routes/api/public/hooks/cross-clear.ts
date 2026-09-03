// Shadow liquidity cross-clearing sweep (race-to-clear).
// POST /api/public/hooks/cross-clear            → sweep dispatched, unbound assets
// POST /api/public/hooks/cross-clear {deal_id}  → race one asset now
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/cross-clear")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, hint: "POST to race dispatched assets across B2B + C2C tiers" }),
      POST: async ({ request }) => {
        const started = Date.now();
        try {
          const { claimIdempotencyKey } = await import("@/lib/m2m-protocol.server");
          const idem = request.headers.get("x-idempotency-key");
          const claim = await claimIdempotencyKey(idem, "cross-clear");
          if (!claim.fresh) {
            return Response.json({ ok: true, skipped: "duplicate_idempotency_key", key: idem });
          }

          const body: any = await request.json().catch(() => ({}));
          const dealId: string | undefined = body?.deal_id;
          const limit = Math.min(Number(body?.limit ?? 10), 25);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Tenant attribution on receipt (X-Source-System routing rules).
          const sourceHeader = request.headers.get("x-source-system");
          let routing: any = null;
          if (dealId) {
            const { routeTenantDeal, applyTenantRouting } = await import(
              "@/lib/tenant-routing.server"
            );
            const { data: existing } = await supabaseAdmin
              .from("closing_pipeline_items")
              .select("apn, base_contract_price, asset_type")
              .eq("id", dealId)
              .maybeSingle();
            routing = routeTenantDeal(sourceHeader, {
              has_timber: body?.has_timber,
              valuation: Number(
                body?.valuation ?? (existing as any)?.base_contract_price ?? 0,
              ),
              parcel_number: body?.parcel_number ?? (existing as any)?.apn ?? null,
              has_street_utilities: body?.has_street_utilities,
              asset_class: body?.asset_class ?? null,
            });
            await applyTenantRouting(dealId, routing);
          }

          let ids: string[] = [];
          if (dealId) {
            ids = [dealId];
          } else {
            const { data } = await supabaseAdmin
              .from("closing_pipeline_items")
              .select("id")
              .eq("status", "Webhook_Dispatched")
              .is("cleared_at", null)
              .is("escrow_status", null)
              .order("optimized_acquisition_premium", { ascending: false })
              .limit(limit);
            ids = ((data ?? []) as any[]).map((r) => r.id);
          }


          const { raceToClear } = await import("@/lib/m2m-clearing.server");
          const results = [];
          for (const id of ids) {
            try {
              results.push(await raceToClear(id));
            } catch (e) {
              console.error("[cross-clear] race failed", id, e);
            }
          }

          return Response.json({
            ok: true,
            source_system: routing?.source_system ?? "MAIN_CLEARINGHOUSE",
            fee_attribution: routing?.fee_attribution ?? null,
            routing_rule: routing?.rule ?? null,
            raced: results.length,
            won: results.filter((r) => r.ok).length,
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
