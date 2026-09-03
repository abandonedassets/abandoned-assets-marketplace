// Autonomous Allocation Engine — removes the human from the buy side.
//
// Every dispatchable, priced asset is evaluated against standing capital
// (shadow liquidity queue → pre-bound MPC buy boxes → standing buy boxes).
// A match is locked programmatically and the binding assignment agreement is
// auto-generated and transmitted by machine. No browsing, no clicking.
//
// Fail-forward: any single asset error is swallowed; the sweep continues.

export type AllocationOutcome = {
  deal_id: string;
  action: "shadow_routed" | "pre_bound" | "buy_box_locked" | "skipped";
  buy_box_id?: string;
  buyer_id?: string;
  esign_token?: string;
  reason?: string;
};

const DISPATCHABLE = [
  "Webhook_Dispatched",
  "Pending-Underwriting",
  "Shadow_Matched",
  "New",
];

function origin(): string {
  return process.env["PUBLIC_APP_URL"] || "https://asset-weaver-30.lovable.app";
}

async function buyerEmail(buyerId: string | null): Promise<string | null> {
  if (!buyerId) return null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("buyer_waitlist")
      .select("contact_email")
      .eq("id", buyerId)
      .maybeSingle();
    const email = (data as { contact_email?: string | null } | null)?.contact_email ?? null;
    return email && email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

/** Strict standing-buy-box match: every criterion must pass. */
function matchBox(
  asset: Record<string, any>,
  boxes: Record<string, any>[],
): Record<string, any> | null {
  const price = Number(asset["base_contract_price"] ?? 0);
  const fee = Number(asset["optimized_acquisition_premium"] ?? 0);
  return (
    boxes.find((b) => {
      try {
        if (price > Number(b["max_contract_price"] ?? 0)) return false;
        if (fee < Number(b["min_placement_margin"] ?? 0)) return false;
        if (Number(b["capital_to_deploy_usd"] ?? 0) < price) return false;
        const zips: string[] = b["target_zip_codes"] ?? [];
        const types: string[] = b["target_asset_types"] ?? [];
        if (zips.length && !zips.includes(String(asset["zip"] ?? ""))) return false;
        if (types.length && !types.includes(String(asset["asset_type"] ?? ""))) return false;
        const exp = b["window_expiration"] ? Date.parse(b["window_expiration"]) : null;
        if (exp && exp < Date.now()) return false;
        return true;
      } catch {
        return false;
      }
    }) ?? null
  );
}

export async function runAutoAllocation(limit = 50): Promise<{
  ok: boolean;
  scanned: number;
  locked: number;
  contracts_sent: number;
  results: AllocationOutcome[];
}> {
  const results: AllocationOutcome[] = [];
  let locked = 0;
  let contracts = 0;

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: assets } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,zip,asset_type,base_contract_price,optimized_acquisition_premium,status,has_signed_marketing_auth",
      )
      .in("status", DISPATCHABLE as never)
      .is("matched_buy_box_id", null)
      .is("cleared_at", null)
      .gt("base_contract_price", 0)
      .gt("optimized_acquisition_premium", 0)
      .order("optimized_acquisition_premium", { ascending: false })
      .limit(limit);

    const rows = (assets ?? []) as Record<string, any>[];
    if (!rows.length) {
      return { ok: true, scanned: 0, locked: 0, contracts_sent: 0, results };
    }

    const { data: boxData } = await supabaseAdmin
      .from("buyer_buy_boxes")
      .select(
        "id,buyer_id,label,target_zip_codes,target_asset_types,max_contract_price,min_placement_margin,capital_to_deploy_usd,window_expiration,urgency_score",
      )
      .eq("active", true)
      .is("deprecated_at", null)
      .order("urgency_score", { ascending: false })
      .limit(200);
    const boxes = (boxData ?? []) as Record<string, any>[];

    for (const a of rows) {
      try {
        const asset = {
          id: String(a["id"]),
          zip: a["zip"] ?? null,
          asset_type: a["asset_type"] ?? null,
          base_contract_price: Number(a["base_contract_price"] ?? 0),
          optimized_acquisition_premium: Number(a["optimized_acquisition_premium"] ?? 0),
        };

        // 1. Shadow liquidity ($105M standing pool) gets first refusal.
        try {
          const { routeShadowLiquidity } = await import("@/lib/shadow-liquidity.server");
          const shadow = await routeShadowLiquidity(asset);
          if (shadow?.dispatched) {
            results.push({
              deal_id: asset.id,
              action: "shadow_routed",
              buyer_id: shadow.buyer_id,
            });
            continue;
          }
        } catch {
          /* fail-forward */
        }

        // 2. Pre-bound MPC buy boxes execute assignment with no signature hop.
        try {
          const { executePreBinding } = await import("@/lib/pre-binding.server");
          const pb = await executePreBinding(asset);
          if (pb.executed) {
            locked += 1;
            results.push({
              deal_id: asset.id,
              action: "pre_bound",
              buy_box_id: pb.buy_box_id ?? "",
              buyer_id: pb.buyer_id ?? "",
            });
            continue;
          }
        } catch {
          /* fail-forward */
        }

        // 3. Standing buy box → programmatic allocation lock.
        const hit = matchBox(a, boxes);
        if (!hit) {
          results.push({ deal_id: asset.id, action: "skipped", reason: "no_standing_capital" });
          continue;
        }

        // 3a. HFT squeeze — 15s TTL micro-auction across the top matched tiers.
        try {
          const { openMicroAuction, fillMicroAuction } = await import("@/lib/ttl-auction.server");
          const tiers = boxes
            .filter((b) => matchBox(a, [b]))
            .slice(0, 8)
            .map((b) => ({ id: String(b["id"]), buyer_id: b["buyer_id"] ?? null }));
          await openMicroAuction({
            dealId: asset.id,
            price: asset.base_contract_price,
            boxes: tiers,
          });
          await fillMicroAuction(asset.id, String(hit["id"]));
        } catch {
          /* fail-forward */
        }

        // 3b. Maker/Taker modifier on the extraction fee.
        let fee = asset.optimized_acquisition_premium;
        try {
          // Evolved spread target — the meta-evolution engine tunes this live.
          const { loadParams } = await import("@/lib/meta-evolution.server");
          const target = (await loadParams())["spread_target_pct"] ?? 0.1;
          fee = Math.max(fee, Math.round(asset.base_contract_price * target));
        } catch {
          /* fail-forward */
        }
        try {
          const { feeModifierBps, applyModifier } = await import("@/lib/maker-taker.server");
          fee = applyModifier(fee, await feeModifierBps(hit["buyer_id"] ?? null));
        } catch {
          /* fail-forward */
        }

        await supabaseAdmin
          .from("closing_pipeline_items")
          .update({
            matched_buy_box_id: hit["id"],
            matched_buyer_id: hit["buyer_id"],
            optimized_acquisition_premium: fee,
            status: "Under-Review",
            offer_sent_at: new Date().toISOString(),
            offer_expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
          } as never)
          .eq("id", asset.id);
        locked += 1;

        // 3c. Anti-Deed matrix — close as a membership interest transfer.
        try {
          const { executeMita } = await import("@/lib/spv-wrapper.server");
          await executeMita(asset.id, hit["buyer_id"] ?? null);
        } catch {
          /* fail-forward */
        }


        const out: AllocationOutcome = {
          deal_id: asset.id,
          action: "buy_box_locked",
          buy_box_id: String(hit["id"]),
          buyer_id: String(hit["buyer_id"]),
        };

        // 4. Autonomous agreement generation — machine-issued, token-executed.
        const email = await buyerEmail(hit["buyer_id"] ?? null);
        if (email) {
          try {
            const { createAndSendContract } = await import("@/lib/esign.server");
            const c = await createAndSendContract({
              dealId: asset.id,
              buyerEmail: email,
              origin: origin(),
            });
            if (c.ok) {
              contracts += 1;
              out.esign_token = c.token;
            } else {
              out.reason = c.error;
            }
          } catch (e) {
            out.reason = (e as Error).message;
          }
        } else {
          out.reason = "buyer_email_missing";
        }

        await supabaseAdmin
          .from("system_audit_logs")
          .insert({
            pipeline_item_id: asset.id,
            event_type: "AUTONOMOUS_ALLOCATION",
            reason: `Programmatic lock to buy box ${hit["label"] ?? hit["id"]}`,
            payload: out as never,
          } as never)
          .then(undefined, () => {});

        results.push(out);
      } catch (e) {
        results.push({
          deal_id: String(a["id"]),
          action: "skipped",
          reason: (e as Error).message,
        });
      }
    }

    return { ok: true, scanned: rows.length, locked, contracts_sent: contracts, results };
  } catch (e) {
    console.error("[auto-allocate] sweep failed", e);
    return { ok: false, scanned: 0, locked, contracts_sent: contracts, results };
  }
}
