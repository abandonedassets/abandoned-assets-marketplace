// POST /api/m2m/reserve — Dark Pool Conditional Reserve + deterministic sequencer.
// Buyer machines lock capital against an asset (FIRM once signed, CONDITIONAL
// while it sits in GREY_POOL). First microsecond stamp wins; losers get 409.
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key, X-Fee-Ack",
};

export const Route = createFileRoute("/api/m2m/reserve")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          const auth = request.headers.get("authorization") ?? "";
          const key = (
            auth.toLowerCase().startsWith("bearer ")
              ? auth.slice(7)
              : (request.headers.get("x-api-key") ?? "")
          ).trim();
          if (!key) return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });

          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const dealId = String(body["property_id"] ?? body["deal_id"] ?? "").trim();
          if (!/^[0-9a-f-]{36}$/i.test(dealId))
            return Response.json({ error: "invalid_property_id" }, { status: 400, headers: CORS });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: box } = await supabaseAdmin
            .from("buyer_buy_boxes")
            .select("id, label, active")
            .eq("m2m_api_key", key)
            .maybeSingle();
          if (!box || !(box as { active?: boolean }).active)
            return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });

          const { data: deal } = await supabaseAdmin
            .from("closing_pipeline_items")
            .select(
              "id, status, signed_contract_hash, base_contract_price, optimized_acquisition_premium",
            )
            .eq("id", dealId)
            .maybeSingle();
          if (!deal) return Response.json({ error: "not_found" }, { status: 404, headers: CORS });
          const d = deal as Record<string, unknown>;

          const { feeLock, verifyFeeAck, greyPoolFlag, sequencerClaim, nextAvailableAsset } =
            await import("@/lib/sovereign-m2m.server");

          const lock = feeLock(
            dealId,
            Number(d["base_contract_price"] ?? 0),
            Number(d["optimized_acquisition_premium"] ?? 0),
          );
          const grey = greyPoolFlag(
            d["status"] as string | null,
            (d["signed_contract_hash"] as string | null) ?? null,
          );

          const ack = request.headers.get("x-fee-ack") ?? (body["fee_ack_hash"] as string | null);
          if (!verifyFeeAck(ack, lock.fee_ack_hash))
            return Response.json(
              { reserved: false, error: "FEE_ACK_REQUIRED", fee_lock: lock },
              { status: 402, headers: CORS },
            );

          const mode = grey.grey_pool ? "CONDITIONAL" : "FIRM";
          const claim = await sequencerClaim({
            dealId,
            buyerRef: String((box as { id: string }).id),
            mode,
            feeAckHash: lock.fee_ack_hash,
            capitalUsd: Number(body["reserved_capital_usd"] ?? lock.total_wire_instruction),
          });

          if (!claim.ok && claim.status === 409)
            return Response.json(
              {
                reserved: false,
                error: "ASSET_CLEARED",
                winner_ref: claim.winner_ref ?? null,
                next_asset: await nextAvailableAsset(dealId),
              },
              { status: 409, headers: CORS },
            );

          if (!claim.ok)
            return Response.json(
              { reserved: false, error: claim.error ?? "reserve_failed" },
              { status: 500, headers: CORS },
            );

          return Response.json(
            {
              reserved: true,
              mode,
              grey_pool: grey.grey_pool,
              reservation_id: claim.reservation_id,
              stamp_micros: claim.stamp_micros,
              fee_lock: lock,
              arms_on: grey.grey_pool ? "SELLER_SIGNATURE_HASH" : "IMMEDIATE",
              settlement_hook:
                "https://abandonedasset.online/api/public/hooks/stripe-settlement",
            },
            { status: 200, headers: { ...CORS, "Cache-Control": "no-store" } },
          );
        } catch (e) {
          console.error("[m2m] reserve failed", e);
          return Response.json({ error: "reserve_failed" }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
