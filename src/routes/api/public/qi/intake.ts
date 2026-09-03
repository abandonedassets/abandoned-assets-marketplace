// POST /api/public/qi/intake — 1031 Exchange / Qualified Intermediary buyer intake.
// Reverse-engineered escrow match: capture the buyer's liquid capital, target
// yield and IRS 45-day clock BEFORE sourcing assets. Zero-friction: partial
// records are still accepted and marked active.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const schema = z.object({
  qi_entity: z.string().trim().min(2).max(180),
  contact_email: z.string().trim().email().max(180).optional(),
  contact_phone: z.string().trim().max(40).optional(),
  label: z.string().trim().max(120).optional(),
  target_zip_codes: z.array(z.string().regex(/^\d{5}$/)).min(1).max(500),
  target_asset_types: z.array(z.string().trim().max(40)).max(20).optional(),
  capital_to_deploy_usd: z.number().finite().min(0).max(5_000_000_000).optional(),
  max_contract_price: z.number().finite().min(1).max(500_000_000),
  min_cap_rate: z.number().finite().min(0).max(0.5).optional(),
  min_placement_margin: z.number().finite().min(0).max(100).optional(),
  // Either the deadline itself, or the relinquished-property closing date (+45d).
  exchange_deadline_at: z.string().trim().max(40).optional(),
  relinquished_closed_at: z.string().trim().max(40).optional(),
});

export const Route = createFileRoute("/api/public/qi/intake")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          const parsed = schema.safeParse(body);
          if (!parsed.success) {
            return Response.json(
              { ok: false, error: "invalid_payload", issues: parsed.error.issues.slice(0, 6) },
              { status: 400, headers: CORS },
            );
          }
          const d = parsed.data;

          const { exchangeWindow, IDENTIFICATION_WINDOW_DAYS } = await import("@/lib/qi");
          let deadline: string;
          if (d.exchange_deadline_at && Number.isFinite(Date.parse(d.exchange_deadline_at))) {
            deadline = new Date(Date.parse(d.exchange_deadline_at)).toISOString();
          } else {
            deadline = exchangeWindow(d.relinquished_closed_at ?? null).deadlineAt;
          }
          const daysRemaining = Math.max(
            0,
            Math.ceil((Date.parse(deadline) - Date.now()) / 86400_000),
          );
          // Urgency is inverse to the remaining clock — a Day-40 buyer outranks everyone.
          const urgency = Number(
            Math.min(1, 1 - daysRemaining / IDENTIFICATION_WINDOW_DAYS).toFixed(4),
          );

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const buyerId = crypto.randomUUID();

          const { data: box, error } = await supabaseAdmin
            .from("buyer_buy_boxes")
            .insert({
              buyer_id: buyerId,
              label: d.label ?? `${d.qi_entity} — 1031 exchange`,
              persona: "EXCHANGE_1031",
              is_1031_buyer: true,
              qi_entity: d.qi_entity,
              exchange_deadline_at: deadline,
              window_expiration: deadline,
              target_zip_codes: d.target_zip_codes,
              target_asset_types: d.target_asset_types ?? ["SFR", "MF", "LAND", "COMMERCIAL"],
              max_contract_price: d.max_contract_price,
              min_placement_margin:
                d.min_placement_margin ??
                (d.min_cap_rate != null ? Number((d.min_cap_rate * 100).toFixed(2)) : 8),
              capital_to_deploy_usd: d.capital_to_deploy_usd ?? d.max_contract_price,
              urgency_score: urgency,
              buyer_priority: "priority",
              active: true,
            } as never)
            .select("id")
            .maybeSingle();
          if (error) throw new Error(error.message);

          if (d.contact_email || d.contact_phone) {
            await supabaseAdmin
              .from("buyer_waitlist")
              .insert({
                fund_name: d.qi_entity,
                contact_email: d.contact_email ?? null,
                contact_phone: d.contact_phone ?? null,
                target_zips: d.target_zip_codes,
                buyer_tier: "1031",
                status: "active",
                message: `1031 identification deadline ${deadline}`,
              } as never)
              .then(
                () => null,
                (e) => console.error("[qi-intake] waitlist failed", e),
              );
          }

          return Response.json(
            {
              ok: true,
              buy_box_id: (box as { id?: string } | null)?.id ?? null,
              buyer_id: buyerId,
              qi_entity: d.qi_entity,
              identification_deadline: deadline,
              days_remaining: daysRemaining,
              urgency_score: urgency,
              next: "Matching assets dispatch automatically as they clear underwriting.",
            },
            { headers: { ...CORS, "Cache-Control": "no-store" } },
          );
        } catch (e) {
          console.error("[qi/intake] failed", e);
          return Response.json({ ok: false, error: "unhandled" }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
