// Settlement Loop — title agent closing confirmation.
// The title/escrow platform POSTs here when the deed records and the file
// closes. HMAC-verified. Flips escrow status and fires the Stripe Connect
// assignment-fee payout to the business bank account.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

function verify(sig: string | null, raw: string, secret: string): boolean {
  if (!secret) return false;
  if (!sig) return false;
  try {
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const a = Buffer.from(sig.replace(/^sha256=/, ""));
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/hooks/title-closed")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, hint: "POST signed title closing confirmations here" }),
      POST: async ({ request }) => {
        const raw = await request.text();
        const secret = process.env.TITLE_WEBHOOK_SECRET ?? "";
        const sig =
          request.headers.get("x-title-signature") ?? request.headers.get("x-signature");
        if (!verify(sig, raw, secret)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let body: any;
        try {
          body = JSON.parse(raw);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const dealId: string | undefined = body?.deal_id || body?.metadata?.deal_id;
        if (!dealId) return Response.json({ received: true, warn: "no_deal_id" });

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin
            .from("closing_pipeline_items")
            .update({
              escrow_status: "closed",
              title_status: body?.title_status ?? "Insured",
              title_notes: body?.notes ?? null,
            } as never)
            .eq("id", dealId);

          await supabaseAdmin
            .from("title_packages")
            .update({ package_status: "Delivered" as never, payload: body as never })
            .eq("pipeline_item_id", dealId);
        } catch (e) {
          console.error("[title-closed] state update failed", e);
        }

        let payout: unknown = { ok: false, reason: "not_attempted" };
        try {
          const { captureAssignmentFee } = await import("@/lib/assignment-fee.server");
          const capture = await captureAssignmentFee(dealId);
          if (!capture.ok) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            await supabaseAdmin.from("dead_letter_queue" as never).insert({
              source: "title-closed:assignment-fee-capture",
              payload: { deal_id: dealId, error: capture.error } as never,
            } as never);
            return Response.json({ received: true, deal_id: dealId, capture, payout });
          }
          const { payoutAssignmentFee } = await import("@/lib/payout.server");
          payout = await payoutAssignmentFee(dealId);
        } catch (e) {
          console.error("[title-closed] payout failed", e);
        }

        return Response.json({ received: true, deal_id: dealId, payout });
      },
    },
  },
});
