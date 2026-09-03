import { createFileRoute } from "@tanstack/react-router";

// Pass G — The Portfolio Rebundler.
// Sweeps deals that are >7 days old, still unmatched (no Orange Square hit),
// not bundled, not held, not cleared. Clusters by (asset_type, 5-digit zip)
// as the geographic proxy, applies a 15% institutional bulk discount on the
// aggregate fee, and publishes the bundle to the Institutional Tape.
//
// Fail-forward: per-cluster try/catch, always returns 200.

const STALE_DAYS = 7;
const BULK_DISCOUNT_PCT = 15;
const MIN_CLUSTER_SIZE = 2;

const ACTIVE_STATUSES = [
  "New",
  "Triaged",
  "Underwritten",
  "Buyer-Matched",
  "Buyer-Signed",
];

export const Route = createFileRoute("/api/public/hooks/rebundle-stale")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, note: "POST to run rebundler" }),
      POST: async () => {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const cutoff = new Date(
          Date.now() - STALE_DAYS * 86400_000,
        ).toISOString();

        const { data: stale, error: selErr } = await supabaseAdmin
          .from("closing_pipeline_items")
          .select(
            "id, zip, asset_type, base_contract_price, optimized_acquisition_premium",
          )
          .is("matched_buyer_id", null)
          .is("bundle_id", null)
          .eq("is_held", false)
          .in("status", ACTIVE_STATUSES as any)
          .lt("created_at", cutoff);

        if (selErr) {
          return Response.json(
            { ok: false, error: `select_failed: ${selErr.message}` },
            { status: 200 },
          );
        }
        if (!stale || stale.length === 0) {
          return Response.json({ ok: true, clusters: 0, assigned: 0 });
        }

        // Cluster by (asset_type, zip5)
        const clusters = new Map<string, typeof stale>();
        for (const d of stale) {
          if (!d.zip) continue;
          const t = (d.asset_type ?? "SFR").trim();
          const key = `${t}|${d.zip}`;
          if (!clusters.has(key)) clusters.set(key, []);
          clusters.get(key)!.push(d);
        }

        let clustersCreated = 0;
        let assigned = 0;

        for (const [key, deals] of clusters) {
          if (deals.length < MIN_CLUSTER_SIZE) continue;
          try {
            const [assetType, zip] = key.split("|");
            const totalBase = deals.reduce(
              (s, d) => s + Number(d.base_contract_price ?? 0),
              0,
            );
            const grossFee = deals.reduce(
              (s, d) => s + Number(d.optimized_acquisition_premium ?? 0),
              0,
            );
            const netFee = Math.round(grossFee * (1 - BULK_DISCOUNT_PCT / 100));

            const { data: bundle, error: bErr } = await supabaseAdmin
              .from("bundles")
              .insert({
                name: `${assetType} Tranche — ZIP ${zip} (${deals.length})`,
                region_tag: zip,
                status: "open",
                bulk_discount_pct: BULK_DISCOUNT_PCT,
                institutional_tape: true,
                deal_count: deals.length,
                total_base: totalBase,
                total_fee: netFee,
                total_arv: totalBase + netFee,
                criteria: {
                  asset_type: assetType,
                  zip,
                  rebundled_at: new Date().toISOString(),
                  gross_fee: grossFee,
                  discount_pct: BULK_DISCOUNT_PCT,
                } as any,
              })
              .select("id")
              .single();

            if (bErr || !bundle) throw new Error(bErr?.message ?? "no bundle id");

            const ids = deals.map((d) => d.id);
            const { error: uErr } = await supabaseAdmin
              .from("closing_pipeline_items")
              .update({ bundle_id: bundle.id })
              .in("id", ids);

            if (uErr) throw new Error(uErr.message);

            clustersCreated++;
            assigned += ids.length;
          } catch (e) {
            try {
              await supabaseAdmin.from("dead_letter_queue").insert({
                raw_payload: { cluster: key, count: deals.length } as any,
                source_ip: "cron",
                error_reason: `rebundle_failed: ${(e as Error).message}`,
              });
            } catch {}
          }
        }

        return Response.json({
          ok: true,
          clusters: clustersCreated,
          assigned,
          ran_at: new Date().toISOString(),
        });
      },
    },
  },
});
