import { createFileRoute } from "@tanstack/react-router";

/** Key-gated manual offer dispatch for controlled tracer runs. */
export const Route = createFileRoute("/api/public/tracer-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["TRACER_DISPATCH_KEY"];
        if (!key || request.headers.get("x-tracer-key") !== key) {
          return new Response("Unauthorized", { status: 401 });
        }
        let dealId = "";
        try {
          const body = (await request.json()) as { dealId?: string };
          dealId = String(body.dealId ?? "");
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        if (!/^[0-9a-f-]{36}$/i.test(dealId)) {
          return new Response("Bad request", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { dispatch_offer } = await import("@/lib/dispatch-gmail.server");

        const { data: deal } = await supabaseAdmin
          .from("closing_pipeline_items")
          .select(
            "id, external_id, apn, address, city, zip, base_contract_price, optimized_acquisition_premium, title_status, matched_buy_box_id",
          )
          .eq("id", dealId)
          .maybeSingle();
        if (!deal) return Response.json({ ok: false, error: "deal_not_found" }, { status: 404 });
        if (!deal.matched_buy_box_id)
          return Response.json({ ok: false, error: "no_matched_buy_box" });

        const { data: box } = await supabaseAdmin
          .from("buyer_buy_boxes")
          .select("id, label, contact_email")
          .eq("id", deal.matched_buy_box_id)
          .maybeSingle();
        if (!box?.contact_email)
          return Response.json({ ok: false, error: "buy_box_has_no_contact_email" });

        const res = await dispatch_offer(deal, {
          id: box.id,
          contact_email: box.contact_email,
          label: box.label,
        });

        if (res.ok) {
          await supabaseAdmin
            .from("closing_pipeline_items")
            .update({
              offer_sent_at: new Date().toISOString(),
              offer_stage: "sent",
              tif_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            } as never)
            .eq("id", dealId);
        }
        return Response.json({ ...res, to: box.contact_email });
      },
    },
  },
});
