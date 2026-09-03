// POST /api/public/hooks/reverse-strike
// Automated counter-offer dispatch at absolute_floor_price with a seller
// e-sign link. Fail-forward: one bad asset never stalls the batch.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/reverse-strike")({
  server: {
    handlers: {
      GET: async () => run(25),
      POST: async ({ request }) => {
        let limit = 25;
        try {
          const b = (await request.json()) as { limit?: number };
          limit = Math.min(Math.max(Number(b?.limit ?? 25), 1), 100);
        } catch {
          /* empty body */
        }
        return run(limit);
      },
    },
  },
});

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const SITE = process.env["PUBLIC_SITE_URL"] ?? "https://asset-weaver-30.lovable.app";

export async function run(limit: number) {
  const started = Date.now();
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,address,city,state,zip,base_contract_price,absolute_floor_price,calculated_arv,estimated_repairs,enrichment_tags,seller_routing_json,has_signed_marketing_auth,is_fee_positive",
      )
      .eq("has_signed_marketing_auth", false)
      .not("status", "in", '("Closed","Dead","Funds-Cleared","Auto_Archived_Bad_Data")')
      .order("updated_at", { ascending: true })
      .limit(limit * 3);
    if (error) throw new Error(error.message);

    const results: Record<string, unknown>[] = [];
    let sent = 0;

    for (const r of ((rows ?? []) as Record<string, any>[]).slice(0, limit * 3)) {
      if (sent >= limit) break;
      try {
        const tags: string[] = Array.isArray(r["enrichment_tags"]) ? r["enrichment_tags"] : [];
        if (tags.includes("REVERSE_STRIKE_SENT")) continue;

        const ready = tags.includes("REVERSE_STRIKE_READY") || r["is_fee_positive"] === false;
        if (!ready) continue;

        const arv = Number(r["calculated_arv"] ?? 0);
        const repairs = Number(r["estimated_repairs"] ?? 0);
        const price = Number(r["base_contract_price"] ?? 0);
        let floor = Number(r["absolute_floor_price"] ?? 0);
        if (!floor || floor <= 0) {
          const basis = arv > 0 ? arv : price * 1.25;
          floor = Math.round(basis * 0.7 - repairs - 5000);
        }
        if (floor <= 0) {
          results.push({ id: r["id"], skipped: "no_viable_floor" });
          continue;
        }

        const { sellerToken } = await import("@/lib/seller-link.server");
        const link = `${SITE}/seller/agreement/${r["id"]}?offer=${floor}&token=${await sellerToken(String(r["id"]))}`;
        const message = `Our institutional 1031 clearinghouse can guarantee an immediate closing at $${floor.toLocaleString()}. To clear this property for capital dispatch, sign the marketing & assignment authorization here: ${link}`;
        const routing = (r["seller_routing_json"] ?? {}) as { email?: string; webhook_url?: string };

        const attempts: Array<{ channel: string; ok: boolean; error?: string }> = [];

        if (routing.webhook_url) {
          try {
            const resp = await fetch(routing.webhook_url, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Event": "reverse_strike" },
              body: JSON.stringify({ asset_id: r["id"], counter_offer: floor, sign_url: link, message }),
            });
            attempts.push({ channel: "webhook", ok: resp.ok });
          } catch (e) {
            attempts.push({ channel: "webhook", ok: false, error: (e as Error).message });
          }
        }

        if (routing.email && process.env["LOVABLE_API_KEY"] && process.env["RESEND_API_KEY"]) {
          try {
            const resp = await fetch(`${GATEWAY_URL}/emails`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`,
                "X-Connection-Api-Key": process.env["RESEND_API_KEY"]!,
              },
              body: JSON.stringify({
                from: process.env["ESCROW_SENDER_EMAIL"] ?? "onboarding@resend.dev",
                to: [routing.email],
                subject: `Guaranteed cash close — $${floor.toLocaleString()} — ${r["address"] ?? r["zip"]}`,
                html: `<p>${message.replace(link, `<a href="${link}">${link}</a>`)}</p>`,
              }),
            });
            attempts.push({ channel: "email", ok: resp.ok });
          } catch (e) {
            attempts.push({ channel: "email", ok: false, error: (e as Error).message });
          }
        }

        const nextTags = [...new Set([...tags, "REVERSE_STRIKE_READY", "REVERSE_STRIKE_SENT"])];
        await supabaseAdmin
          .from("closing_pipeline_items")
          .update({
            absolute_floor_price: floor,
            enrichment_tags: nextTags,
          } as never)
          .eq("id", r["id"]);

        await supabaseAdmin.from("system_audit_logs").insert({
          pipeline_item_id: r["id"],
          event_type: "REVERSE_STRIKE_SENT",
          reason: "Automated counter-offer dispatched at absolute floor price",
          payload: { counter_offer: floor, sign_url: link, channels: attempts },
        } as never);

        sent += 1;
        results.push({ id: r["id"], counter_offer: floor, sign_url: link, channels: attempts });
      } catch (e) {
        results.push({ id: r["id"], error: (e as Error).message });
      }
    }

    return Response.json({ ok: true, counters_sent: sent, ms: Date.now() - started, results });
  } catch (e) {
    return Response.json({ ok: false, counters_sent: 0, error: (e as Error).message }, { status: 500 });
  }
}
