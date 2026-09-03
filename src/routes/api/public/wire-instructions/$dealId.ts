// Buyer-facing Bluevine wire instructions (JSON). No third-party banking API.
// GET /api/public/wire-instructions/:dealId
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/wire-instructions/$dealId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const dealId = (params.dealId ?? "").trim();
        if (!dealId) return Response.json({ ok: false, error: "deal_id_required" }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: deal } = await supabaseAdmin
          .from("closing_pipeline_items")
          .select("id,address,zip,state,optimized_acquisition_premium,payout_status")
          .eq("id", dealId)
          .maybeSingle();
        if (!deal) return Response.json({ ok: false, error: "deal_not_found" }, { status: 404 });

        const d = deal as any;
        const { wireConfig } = await import("@/lib/bluevine.server");
        const cfg = wireConfig();
        if (!cfg.routing || !cfg.account) {
          return Response.json({ ok: false, error: "wire_coordinates_not_configured" }, { status: 503 });
        }

        const { markWireInFlight } = await import("@/lib/wire-lock.server");
        await markWireInFlight(dealId);

        return Response.json(
          {
            ok: true,
            deal_id: dealId,
            amount_usd: Number(d.optimized_acquisition_premium ?? 0),
            payout_status: d.payout_status ?? null,
            reference: `${String(d.address ?? "ASSET").slice(0, 40)} · ${dealId.slice(0, 8).toUpperCase()}`,
            instructions: {
              bank_name: cfg.bank,
              bank_address: cfg.address,
              account_name: cfg.beneficiary,
              beneficiary_address: cfg.beneficiaryAddress,
              routing_number: String(cfg.routing),
              account_number: String(cfg.account),
              rail: "Domestic Fedwire / ACH",
            },
            pdf_url: `/api/public/wire/${dealId}`,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
