// Shadow Liquidity Routing.
// Institutional buyers pre-register capital with rigid parameters. When an
// asset is verified at intake, it is cross-referenced against the shadow queue
// BEFORE it ever reaches the public deal tape. A match triggers a direct,
// zero-touch VDR payload to the buyer's private endpoint.

export type ShadowMatch = {
  queue_id: string;
  buyer_id: string;
  label: string | null;
  webhook_target_url: string;
  dispatched: boolean;
  http_status: number | null;
};

type Asset = {
  id: string;
  zip: string | null;
  asset_type: string | null;
  base_contract_price: number | null;
  optimized_acquisition_premium: number | null;
};

/**
 * Cross-reference one asset against the shadow queue. Fail-forward: any error
 * returns null so the asset continues to the public tape untouched.
 */
export async function routeShadowLiquidity(asset: Asset): Promise<ShadowMatch | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const price = Number(asset.base_contract_price ?? 0);
    if (!price) return null;

    const { data, error } = await supabaseAdmin
      .from("shadow_liquidity_queue")
      .select(
        "id,buyer_id,label,target_zip_codes,target_asset_types,max_purchase_price,required_margin_percentage,webhook_target_url,allocated_capital_usd",
      )
      .eq("is_active", true)
      .gte("max_purchase_price", price)
      .order("allocated_capital_usd", { ascending: false })
      .limit(200);
    if (error || !data?.length) return null;

    const fee = Number(asset.optimized_acquisition_premium ?? 0);
    const marginPct = price > 0 ? (fee / price) * 100 : 0;

    const hit = (data as any[]).find((q) => {
      const zips: string[] = q.target_zip_codes ?? [];
      const types: string[] = q.target_asset_types ?? [];
      const zipOk = zips.length === 0 || (asset.zip ? zips.includes(asset.zip) : false);
      const typeOk =
        types.length === 0 || (asset.asset_type ? types.includes(asset.asset_type) : false);
      return zipOk && typeOk && marginPct >= Number(q.required_margin_percentage ?? 0);
    });
    if (!hit) return null;

    // Mint a headless VDR token for the priority payload.
    let vdrUrl: string | null = null;
    try {
      const { vdrToken } = await import("@/lib/vdr.server");
      const token = await vdrToken(asset.id);
      const base = process.env["PUBLIC_APP_URL"] ?? "https://asset-weaver-30.lovable.app";
      vdrUrl = `${base}/api/public/vdr/${token}`;
    } catch (e) {
      console.error("[shadow] vdr mint failed", e);
    }

    // Time-in-Force: the buyer's algorithm gets a hard 60-second micro-window.
    const TIF_MS = 60_000;
    const dispatchedAt = new Date();
    const tifExpiresAt = new Date(dispatchedAt.getTime() + TIF_MS);

    // IRC §1031 compliance metadata (fail-forward: null block on any error).
    let likeKind: unknown = null;
    try {
      const { likeKindMetadata } = await import("@/lib/qi");
      const { data: meta } = await supabaseAdmin
        .from("closing_pipeline_items")
        .select(
          "qi_entity,is_1031_candidate,exchange_deadline_at,acreage,timber_density_score,estimated_stumpage_mbf,lien_total",
        )
        .eq("id", asset.id)
        .maybeSingle();
      const m = (meta ?? {}) as any;
      likeKind = likeKindMetadata({
        is1031: !!m.is_1031_candidate,
        qiEntity: m.qi_entity,
        deadlineAt: m.exchange_deadline_at,
        acreage: m.acreage,
        timberDensityScore: m.timber_density_score,
        estimatedStumpageMbf: m.estimated_stumpage_mbf,
        contractPrice: price,
        lienTotal: m.lien_total,
      });
    } catch (e) {
      console.error("[shadow] like-kind metadata failed", e);
    }

    const payload = {
      event: "shadow_liquidity.match",
      deal_id: asset.id,
      zip: asset.zip,
      asset_type: asset.asset_type,
      contract_price: price,
      assignment_fee: fee,
      margin_pct: Number(marginPct.toFixed(2)),
      vdr_access_url: vdrUrl,
      matched_queue_id: hit.id,
      dispatched_at: dispatchedAt.toISOString(),
      like_kind_1031: likeKind,
      time_in_force: {
        ttl_ms: TIF_MS,
        expires_at: tifExpiresAt.toISOString(),
        execution_endpoint: `${process.env["PUBLIC_APP_URL"] ?? "https://asset-weaver-30.lovable.app"}/api/m2m/execute`,
        on_expiry: "asset degrades to public deal tape (Scout)",
      },
    };


    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        tif_expires_at: tifExpiresAt.toISOString(),
        tif_dispatched_at: dispatchedAt.toISOString(),
        tif_state: "Pending",
      } as never)
      .eq("id", asset.id);

    let status: number | null = null;
    try {
      // Live production: only absolute, externally-hosted buyer endpoints.
      if (!/^https:\/\//i.test(hit.webhook_target_url)) {
        throw new Error("non_live_webhook_target");
      }
      const res = await fetch(hit.webhook_target_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shadow-Match": "priority",
          "X-VDR-Access": vdrUrl ?? "",
          "X-TIF-TTL-MS": String(TIF_MS),
          "X-TIF-Expires-At": tifExpiresAt.toISOString(),
        },
        body: JSON.stringify(payload),
      });
      status = res.status;
    } catch (e) {
      console.error("[shadow] dispatch failed", e);
    }


    if (status == null || status >= 300) {
      // Never lose the payload — hand it to the resilient outbox.
      await supabaseAdmin
        .from("resilient_outbox")
        .insert({
          target_url: hit.webhook_target_url,
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shadow-Match": "priority" } as never,
          payload: payload as never,
          kind: "shadow_liquidity",
          pipeline_item_id: asset.id,
        } as never)
        .then(undefined, (e: unknown) => console.error("[shadow] outbox insert failed", e));
    }

    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({ status: "Shadow_Matched", matched_buyer_id: hit.buyer_id } as never)
      .eq("id", asset.id);

    await supabaseAdmin
      .from("shadow_liquidity_queue")
      .update({ last_matched_at: new Date().toISOString() } as never)
      .eq("id", hit.id);

    await supabaseAdmin
      .from("system_audit_logs")
      .insert({
        pipeline_item_id: asset.id,
        event_type: "SHADOW_LIQUIDITY_MATCH",
        reason: `Routed to ${hit.label ?? hit.id} (${status ?? "queued"})`,
        payload: payload as never,
      } as never)
      .then(undefined, () => {});

    return {
      queue_id: hit.id,
      buyer_id: hit.buyer_id,
      label: hit.label ?? null,
      webhook_target_url: hit.webhook_target_url,
      dispatched: status != null && status < 300,
      http_status: status,
    };
  } catch (e) {
    console.error("[shadow] routing failed", e);
    return null;
  }
}
