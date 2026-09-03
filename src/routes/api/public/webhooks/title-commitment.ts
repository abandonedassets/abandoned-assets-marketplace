// Title platform callback: pushes the official Title Commitment PDF and the
// municipal lien search result back into the deal record. HMAC-verified.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/webhooks/title-commitment")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret =
          process.env["TITLE_WEBHOOK_SECRET"] ||
          process.env["M2M_HMAC_SECRET"] ||
          process.env["PACKET_SIGNING_KEY"];
        const body = await request.text();

        if (secret) {
          const sig = (request.headers.get("x-title-signature") ?? "").replace(/^sha256=/, "");
          const { createHmac, timingSafeEqual } = await import("crypto");
          const expected = createHmac("sha256", secret).update(body).digest("hex");
          const a = Buffer.from(sig);
          const b = Buffer.from(expected);
          if (a.length !== b.length || !timingSafeEqual(a, b)) {
            return new Response("Invalid signature", { status: 401 });
          }
        }

        let payload: any;
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const dealId = String(payload?.deal_id ?? "").trim();
        if (!dealId) return new Response("deal_id required", { status: 400 });

        const commitmentUrl: string | null = payload?.title_commitment_url ?? payload?.document_url ?? null;
        const lien = payload?.lien_search ?? payload?.municipal_lien_search ?? null;
        const rawStatus = String(payload?.title_status ?? "").toLowerCase();
        const titleStatus =
          rawStatus.includes("uninsur") ? "Uninsurable" : rawStatus.includes("insur") ? "Insured" : "Pending";

        // Real escrow file number returned by the title platform — this is the
        // only legitimate source for the TITLE_ESCROW settlement gate.
        const escrowFile: string | null =
          payload?.escrow_file_number ??
          payload?.title_escrow_file_number ??
          payload?.file_number ??
          payload?.order_id ??
          null;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        await supabaseAdmin
          .from("closing_pipeline_items")
          .update({
            title_commitment_url: commitmentUrl,
            lien_search_result: lien as never,
            title_status: titleStatus as never,
            ...(escrowFile ? { title_escrow_file_number: String(escrowFile).trim() } : {}),
          } as never)
          .eq("id", dealId);

        await supabaseAdmin
          .from("title_packages")
          .upsert(
            {
              pipeline_item_id: dealId,
              package_status: "Built" as never,
              payload: payload as never,
            } as never,
            { onConflict: "pipeline_item_id" },
          );

        return Response.json({
          ok: true,
          deal_id: dealId,
          title_status: titleStatus,
          escrow_file_number: escrowFile ?? null,
        });
      },
    },
  },
});
