import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const Schema = z.object({
  deal_id: z.string().uuid(),
  cleared_amount: z.number().min(0).max(100_000_000),
  title_company_ref: z.string().min(1).max(255).optional(),
  cleared_at: z.string().datetime().optional(),
});

function verify(sig: string | null, body: string, secret: string): boolean {
  if (!sig || !secret) return false;
  try {
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/hooks/escrow-cleared")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.FLOW_CALLBACK_SECRET ?? "";
        const body = await request.text();
        const sig = request.headers.get("x-escrow-signature");
        if (!verify(sig, body, secret)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let parsed: z.infer<typeof Schema>;
        try {
          parsed = Schema.parse(JSON.parse(body));
        } catch (e: any) {
          return Response.json(
            { error: "invalid_input", message: String(e?.message ?? e) },
            { status: 400 },
          );
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const cleared_at = parsed.cleared_at ?? new Date().toISOString();
        const { data, error } = await supabaseAdmin
          .from("closing_pipeline_items")
          .update({
            status: "Funds-Cleared",
            escrow_status: "cleared",
            cleared_at,
            cleared_amount: parsed.cleared_amount,
            lock_expires_at: null,
          } as any)
          .eq("id", parsed.deal_id)
          .select("id, locked_at")
          .maybeSingle();

        if (error) {
          return Response.json(
            { error: "update_failed", message: error.message },
            { status: 500 },
          );
        }
        if (!data) {
          return Response.json({ error: "not_found" }, { status: 404 });
        }

        // Non-performer scorecard: reward the buyer who actually funded.
        try {
          const { data: sig } = await supabaseAdmin
            .from("esign_requests")
            .select("buyer_email")
            .eq("pipeline_item_id", parsed.deal_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const email = (sig as { buyer_email?: string } | null)?.buyer_email;
          if (email) {
            const { recordBuyerEvent } = await import("@/lib/scorecard.server");
            await recordBuyerEvent(email, "funded");
          }
        } catch {
          /* fail-forward */
        }

        // Latency-weighted routing: feed the settlement latency back to the
        // dispatching endpoint so future strikes prefer fast settlers.
        if ((data as any).locked_at) {
          const latency_ms = Math.max(
            0,
            new Date(cleared_at).getTime() -
              new Date((data as any).locked_at).getTime(),
          );
          await supabaseAdmin.rpc("record_endpoint_fill", {
            _deal_id: parsed.deal_id,
            _latency_ms: latency_ms,
          });
        }

        if (parsed.title_company_ref) {
          await supabaseAdmin
            .from("title_packages")
            .update({
              package_status: "Acknowledged" as any,
              title_company_ref: parsed.title_company_ref,
            })
            .eq("pipeline_item_id", parsed.deal_id);
        }

        // Silent Executive Telemetry — fire-and-forget receipt to admin.
        try {
          const { data: deal } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select("zip, locked_by_key_id")
            .eq("id", parsed.deal_id)
            .maybeSingle();
          const { notifyAdmin, fmtUsd } = await import("@/lib/notify.server");
          const keyTag = (deal as any)?.locked_by_key_id
            ? String((deal as any).locked_by_key_id).slice(0, 8)
            : "unknown";
          await notifyAdmin(
            `🟢 TRADE CLEARED: ${fmtUsd(parsed.cleared_amount)} Assignment Fee. Asset ZIP: ${(deal as any)?.zip ?? "—"}. Buyer ID: ${keyTag}.`,
          );
        } catch (e) {
          console.error("notify failed", e);
        }

        return Response.json({ status: "cleared", deal_id: parsed.deal_id });
      },
    },
  },
});

