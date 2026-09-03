// Direct BlueVine Fedwire instruction sheet (PDF) for traditional title desks.
// GET /api/public/wire/$dealId → application/pdf

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/wire/$dealId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const dealId = (params.dealId ?? "").trim();
        if (!dealId) return Response.json({ error: "deal_id_required" }, { status: 400 });

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { data: deal, error } = await supabaseAdmin
          .from("closing_pipeline_items")
          .select("id, zip, address, optimized_acquisition_premium")
          .eq("id", dealId)
          .maybeSingle();

        if (error)
          return Response.json({ error: "lookup_failed", detail: error.message }, { status: 500 });
        if (!deal) return Response.json({ error: "deal_not_found" }, { status: 404 });

        const { markWireInFlight } = await import("@/lib/wire-lock.server");
        await markWireInFlight(dealId);

        const { buildWireInstructionPdf } = await import("@/lib/bluevine.server");
        const bytes = await buildWireInstructionPdf({
          dealId,
          address: (deal as any).address ?? null,
          zip: (deal as any).zip ?? null,
          feeUsd: Number((deal as any).optimized_acquisition_premium ?? 0),
        });

        return new Response(bytes as unknown as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="wire-instructions-${dealId.slice(0, 8)}.pdf"`,
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
