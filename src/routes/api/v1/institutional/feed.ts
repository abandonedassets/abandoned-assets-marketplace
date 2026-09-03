// Algorithmic fund feed — sanitized, HMAC-signed deal tape for quant buy-boxes.
// GET /api/v1/institutional/feed  → X-M2M-Signature: HMAC-SHA256(body)
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Api-Key",
  "Access-Control-Expose-Headers": "X-M2M-Signature, X-M2M-Timestamp",
};

export const Route = createFileRoute("/api/v1/institutional/feed")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const limit = Math.min(Number(url.searchParams.get("limit") ?? 250), 500);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { signM2M, titleCleanHash, TIF_SECONDS, MAX_FEE_SLIPPAGE_BPS } = await import(
            "@/lib/m2m-protocol.server"
          );

          const { data, error } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select(
              "id, apn, parcel_number, county, state, zip, asset_class, asset_type, base_contract_price, optimized_acquisition_premium, calculated_arv, status, verification_status, has_street_utilities, lien_total, title_status, assessed_value, is_dip, dip_case_number, dip_sale_motion_ref, dip_proposed_order_ref, stalking_horse_bid, court_overbid_increment, source_system, fee_attribution",
            )
            .is("cleared_at", null)
            .not("status", "in", '("Dead","Rejected","Closed","Auto_Archived_Bad_Data")')
            .order("optimized_acquisition_premium", { ascending: false })
            .limit(limit);
          if (error) throw new Error(error.message);

          const assets = ((data ?? []) as any[]).map((r) => {
            const title = titleCleanHash({
              apn: r.apn,
              county: r.county,
              lien_total: r.lien_total,
              title_status: r.title_status,
              assessed_value: r.assessed_value,
              is_dip: r.is_dip,
              dip_case_number: r.dip_case_number,
              dip_sale_motion_ref: r.dip_sale_motion_ref,
              dip_proposed_order_ref: r.dip_proposed_order_ref,
            });
            return {
              deal_id: r.id,
              parcel_id: r.parcel_number ?? r.apn ?? null,
              valuation: Number(r.base_contract_price) || 0,
              assignment_fee: Number(r.optimized_acquisition_premium) || 0,
              arv: r.calculated_arv == null ? null : Number(r.calculated_arv),
              asset_class: r.asset_class ?? r.asset_type ?? null,
              state: r.state ?? null,
              zip: r.zip ?? null,
              county: r.county ?? null,
              title_clean_hash: title.title_clean_hash,
              title_clean: title.title_clean,
              title_source: title.title_source,
              has_street_utilities: !!r.has_street_utilities,
              t_impact_status: r.verification_status ?? String(r.status ?? "").toUpperCase().replace(/-/g, "_"),
              fee_attribution: r.fee_attribution ?? null,
              source_system: r.source_system ?? "MAIN_CLEARINGHOUSE",
              section_363: !!r.is_dip,
              stalking_horse_bid: r.stalking_horse_bid == null ? null : Number(r.stalking_horse_bid),
              court_overbid_increment:
                r.court_overbid_increment == null ? null : Number(r.court_overbid_increment),
            };
          });

          const body = JSON.stringify({
            feed: "INSTITUTIONAL_DEAL_TAPE",
            schema_version: "1.0",
            generated_at: new Date().toISOString(),
            tif_seconds: TIF_SECONDS,
            max_fee_slippage_bps: MAX_FEE_SLIPPAGE_BPS,
            count: assets.length,
            aggregate_valuation_usd: assets.reduce((s, a) => s + a.valuation, 0),
            assets,
          });

          return new Response(body, {
            headers: {
              ...CORS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              "X-M2M-Signature": signM2M(body),
              "X-M2M-Timestamp": String(Date.now()),
            },
          });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500, headers: CORS },
          );
        }
      },
    },
  },
});
