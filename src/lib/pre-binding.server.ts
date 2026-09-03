// Shadow Liquidity Pre-Binding.
// A buy box carrying a signed Master Purchase Commitment pre-authorizes this
// system to execute the B-to-C assignment programmatically. Sign 3 becomes a
// zero-latency machine event instead of a manual signature.
// Fail-forward: any error leaves the asset exactly where it was.

export type PreBindResult = {
  executed: boolean;
  buy_box_id?: string;
  buyer_id?: string;
  reason?: string;
};

type Asset = {
  id: string;
  zip: string | null;
  asset_type: string | null;
  base_contract_price: number | null;
  optimized_acquisition_premium: number | null;
};

export async function executePreBinding(asset: Asset): Promise<PreBindResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const price = Number(asset.base_contract_price ?? 0);
    if (!price) return { executed: false, reason: "no_price" };

    const { data } = await supabaseAdmin
      .from("buyer_buy_boxes")
      .select(
        "id,buyer_id,label,target_zip_codes,target_asset_types,max_contract_price,min_placement_margin,pre_binding_authorized,mpc_signed_at",
      )
      .eq("active", true)
      .eq("pre_binding_authorized", true)
      .is("deprecated_at", null)
      .gte("max_contract_price", price)
      .order("urgency_score", { ascending: false })
      .limit(100);
    if (!data?.length) return { executed: false, reason: "no_pre_bound_box" };

    const fee = Number(asset.optimized_acquisition_premium ?? 0);
    const hit = (data as any[]).find((b) => {
      const zips: string[] = b.target_zip_codes ?? [];
      const types: string[] = b.target_asset_types ?? [];
      const zipOk = zips.length === 0 || (asset.zip ? zips.includes(asset.zip) : false);
      const typeOk =
        types.length === 0 || (asset.asset_type ? types.includes(asset.asset_type) : false);
      return zipOk && typeOk && fee >= Number(b.min_placement_margin ?? 0) && !!b.mpc_signed_at;
    });
    if (!hit) return { executed: false, reason: "no_match" };

    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        matched_buyer_id: hit.buyer_id,
        matched_buy_box_id: hit.id,
        status: "Buyer-Signed",
        contract_structure: "PRE_BOUND_MPC",
        offer_sent_at: new Date().toISOString(),
        offer_stage: "standard",
        offer_expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      } as never)
      .eq("id", asset.id);

    await supabaseAdmin
      .from("system_audit_logs")
      .insert({
        pipeline_item_id: asset.id,
        event_type: "PRE_BINDING_EXECUTION",
        reason: `Auto-executed against MPC buy box ${hit.label ?? hit.id}`,
        payload: { buy_box_id: hit.id, buyer_id: hit.buyer_id, fee } as never,
      } as never)
      .then(undefined, () => {});

    // Settlement Loop: MPC executed → order title, lien search, closing docs.
    try {
      const { orderTitle } = await import("@/lib/title-order.server");
      await orderTitle(asset.id, "PRE_BINDING_MPC");
    } catch (e) {
      console.error("[pre-binding] title order failed", e);
    }

    return { executed: true, buy_box_id: hit.id, buyer_id: hit.buyer_id };
  } catch (e) {
    console.error("[pre-binding] failed", e);
    return { executed: false, reason: "error" };
  }
}
