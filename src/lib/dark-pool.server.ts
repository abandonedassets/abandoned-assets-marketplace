// Dark Pool Reverse-Demand Ingestion Engine.
// Buyer capital is polled FIRST; inventory is only surfaced (and skip-traced)
// when it mathematically clears an active buy box. Fail-forward everywhere.

import { sellerAuthUrl } from "./seller-link.server";

type Box = {
  id: string;
  label: string | null;
  contact_email: string | null;
  target_zip_codes: string[] | null;
  target_asset_types: string[] | null;
  max_contract_price: number | null;
  min_placement_margin: number | null;
};

type Asset = Record<string, any>;

export type DarkPoolResult = {
  ok: boolean;
  boxes_polled: number;
  candidates: number;
  skip_traced: number;
  links_generated: number;
  rows: Array<{
    id: string;
    address: string | null;
    box: string | null;
    seller_email: string | null;
    url: string;
    traced: boolean;
    fee: number | null;
    spread_expanded: boolean;
  }>;
};

/** JIT skip-trace: only fires for pre-sold APNs. No key -> no spend, no stall. */
async function skipTrace(asset: Asset): Promise<string | null> {
  const key = process.env["SKIPTRACE_API_KEY"];
  const url = process.env["SKIPTRACE_API_URL"];
  if (!key || !url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        address: asset["address"],
        city: asset["city"],
        state: asset["state"],
        zip: asset["zip"],
        apn: asset["apn"],
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, any>;
    const email =
      j["email"] ?? j["primary_email"] ?? j?.["person"]?.["email"] ?? j?.["emails"]?.[0] ?? null;
    return typeof email === "string" && email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

function clearsMargin(asset: Asset, box: Box): boolean {
  const price = Number(asset["base_contract_price"] ?? 0);
  const fee = Number(asset["optimized_acquisition_premium"] ?? 0);
  if (price <= 0) return false;
  const minMargin = Number(box.min_placement_margin ?? 0);
  if (minMargin <= 0) return true;
  // Stored either as ratio (0.05), percent (7.5), or absolute USD floor (2500)
  if (minMargin <= 1) return fee / price >= minMargin;
  if (minMargin <= 100) return fee / price >= minMargin / 100;
  return fee >= minMargin;
}

/**
 * Dynamic Spread Capture: consume 100% of the delta between the seller floor
 * (base_contract_price) and the buyer ceiling (max_contract_price), minus a
 * 1% safety buffer to guarantee clearing. Never shrinks an existing fee.
 */
const SAFETY_BUFFER = 0.01;

function maximizeSpread(asset: Asset, box: Box): number | null {
  const floor = Number(asset["base_contract_price"] ?? 0);
  const ceiling = Number(box.max_contract_price ?? 0);
  const currentFee = Number(asset["optimized_acquisition_premium"] ?? 0);
  if (floor <= 0 || ceiling <= 0) return null;
  const effectiveCeiling = ceiling * (1 - SAFETY_BUFFER);
  const maxFee = Math.floor(effectiveCeiling - floor);
  if (!Number.isFinite(maxFee) || maxFee <= currentFee) return null;
  return maxFee;
}

export async function runDarkPoolIngest(limitPerBox = 10): Promise<DarkPoolResult> {
  const out: DarkPoolResult = {
    ok: true,
    boxes_polled: 0,
    candidates: 0,
    skip_traced: 0,
    links_generated: 0,
    rows: [],
  };

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: boxData } = await supabaseAdmin
      .from("buyer_buy_boxes")
      .select(
        "id,label,contact_email,target_zip_codes,target_asset_types,max_contract_price,min_placement_margin,active",
      )
      .eq("active", true)
      .limit(50);

    const boxes = ((boxData ?? []) as Box[]).filter((b) => !!b.contact_email);
    out.boxes_polled = boxes.length;
    const seen = new Set<string>();

    for (const box of boxes) {
      try {
        let q = supabaseAdmin
          .from("closing_pipeline_items")
          .select(
            "id,apn,address,city,state,zip,asset_type,seller_email,base_contract_price,optimized_acquisition_premium,has_signed_marketing_auth,matched_buy_box_id",
          )
          .eq("has_signed_marketing_auth", false)
          .not("base_contract_price", "is", null);

        const zips = (box.target_zip_codes ?? []).filter(Boolean);
        if (zips.length > 0) q = q.in("zip", zips);
        const types = (box.target_asset_types ?? []).filter(Boolean);
        if (types.length > 0) q = q.in("asset_type", types);
        if (box.max_contract_price) q = q.lte("base_contract_price", box.max_contract_price);

        const { data: assetData } = await q
          .order("optimized_acquisition_premium", { ascending: false })
          .limit(limitPerBox * 3);

        const matches = ((assetData ?? []) as Asset[])
          .filter((a) => !seen.has(String(a["id"])))
          .filter((a) => clearsMargin(a, box))
          .slice(0, limitPerBox);

        for (const a of matches) {
          const id = String(a["id"]);
          seen.add(id);
          out.candidates += 1;

          let email = (a["seller_email"] as string | null) ?? null;
          let traced = false;
          if (!email) {
            email = await skipTrace(a);
            if (email) {
              traced = true;
              out.skip_traced += 1;
            }
          }

          const patch: Record<string, unknown> = { matched_buy_box_id: box.id };
          if (traced && email) patch["seller_email"] = email;
          const expandedFee = maximizeSpread(a, box);
          if (expandedFee !== null) patch["optimized_acquisition_premium"] = expandedFee;
          try {
            await supabaseAdmin.from("closing_pipeline_items").update(patch as never).eq("id", id);
          } catch {
            /* fail-forward */
          }

          const url = await sellerAuthUrl(id);
          out.links_generated += 1;
          out.rows.push({
            id,
            address: (a["address"] as string | null) ?? null,
            box: box.label ?? box.contact_email,
            seller_email: email,
            url,
            traced,
            fee: expandedFee ?? Number(a["optimized_acquisition_premium"] ?? 0),
            spread_expanded: expandedFee !== null,
          });
        }
      } catch (e) {
        console.error("[darkpool] box failed", box.id, (e as Error).message);
      }
    }
  } catch (e) {
    out.ok = false;
    console.error("[darkpool] fatal", (e as Error).message);
  }

  return out;
}
