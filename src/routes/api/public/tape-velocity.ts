import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Anonymous velocity ledger — broadcasts movement, never the asset.
export const Route = createFileRoute("/api/public/tape-velocity")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const since = new Date(Date.now() - 24 * 3600_000).toISOString();
        const { data: rows } = await supabaseAdmin
          .from("closing_pipeline_items")
          .select(
            "zip, status, base_contract_price, optimized_acquisition_premium, updated_at",
          )
          .gte("updated_at", since)
          .order("updated_at", { ascending: false })
          .limit(50);

        const events = (rows ?? []).map((r: any) => {
          const fee = Number(r.optimized_acquisition_premium) || 0;
          const base = Number(r.base_contract_price) || 0;
          let event = "Asset Repriced";
          if (r.status === "In-Escrow") event = "Asset Cleared";
          else if (r.status === "Buyer-Signed") event = "Buyer Locked";
          else if (r.status === "Seller-Signed") event = "Seller Locked";
          else if (r.status === "Under-Review") event = "Under Review";
          else if (r.status === "New") event = "Tranche Opened";
          return {
            timestamp: r.updated_at,
            event,
            zip_code: (r.zip ?? "").toString().slice(0, 5),
            arv_delta: Math.round((base + fee) * 100) / 100,
          };
        });

        return Response.json(
          {
            header: {
              generated_at: new Date().toISOString(),
              window_hours: 24,
              event_count: events.length,
              disclosure:
                "Anonymous velocity ledger. No addresses or counterparties disclosed. Allocation by invitation only.",
            },
            events,
          },
          {
            headers: {
              ...CORS,
              "Cache-Control": "public, max-age=15",
            },
          },
        );
      },
    },
  },
});
