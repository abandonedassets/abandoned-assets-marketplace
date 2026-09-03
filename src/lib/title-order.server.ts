// Settlement Loop — automated Title / Escrow ordering.
// Fires on pre-binding MPC execution and on Sign-3 EMD lock. Pushes a full
// order payload to the title platform (Qualia-compatible JSON webhook) and
// falls back to a machine-readable email to the closing desk.
// Fail-forward: never throws into the signing path.

const TITLE_DESK_EMAIL = process.env.TITLE_DESK_EMAIL || "Info.abandonedassets@gmail.com";

export type TitleOrderResult = {
  ordered: boolean;
  ref?: string | null;
  channel?: "api" | "email" | "none";
  reason?: string;
};

export async function orderTitle(
  dealId: string,
  trigger: "PRE_BINDING_MPC" | "SIGN3_EMD_LOCK" | "MANUAL",
): Promise<TitleOrderResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: deal } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,address,city,state,zip,county,apn,asset_type,acreage,base_contract_price,optimized_acquisition_premium,lien_total,title_status,matched_buyer_id,title_ordered_at,is_1031_candidate,qi_entity,exchange_deadline_at,contract_structure,buyer_tier_stage",
      )
      .eq("id", dealId)
      .maybeSingle();
    if (!deal) return { ordered: false, reason: "deal_not_found" };
    const d = deal as any;
    if (d.title_ordered_at) return { ordered: false, reason: "already_ordered", channel: "none" };

    const price = Number(d.base_contract_price ?? 0);
    const fee = Number(d.optimized_acquisition_premium ?? 0);
    const { resolveContractMode, contractTerms } = await import("./institutional.server");
    const contractMode = resolveContractMode({
      buyerTier: (d as any).buyer_tier_stage,
      contractStructure: (d as any).contract_structure,
      assetType: d.asset_type,
    });
    const payload = {
      order_type:
        contractMode === "DOUBLE_CLOSE"
          ? "DOUBLE_CLOSE_TITLE_COMMITMENT_AND_LIEN_SEARCH"
          : "TITLE_COMMITMENT_AND_LIEN_SEARCH",
      contract_mode: contractMode,
      settlement_instructions: contractTerms(contractMode, fee),
      trigger,
      deal_id: d.id,
      property: {
        address: d.address,
        city: d.city,
        state: d.state,
        zip: d.zip,
        county: d.county,
        apn: d.apn,
        asset_type: d.asset_type,
        acreage: d.acreage,
      },
      economics: {
        contract_price: price,
        assignment_fee: fee,
        recorded_liens: Number(d.lien_total ?? 0),
        net_to_seller: Math.max(0, price - Number(d.lien_total ?? 0)),
      },
      exchange_1031: d.is_1031_candidate
        ? { qi_entity: d.qi_entity, identification_deadline: d.exchange_deadline_at }
        : null,
      requested_documents: [
        "Title Commitment",
        "Municipal Lien Search",
        "Closing Document Package",
        "Settlement Statement (Blind HUD)",
      ],
      buyer_id: d.matched_buyer_id,
      requested_at: new Date().toISOString(),
    };

    // Attach the in-house generated closing bundle so title receives the
    // executed package alongside the commitment/lien-search order.
    try {
      const { getClosingBundleUrl } = await import("./closing-docs.server");
      (payload as any).closing_package_url = await getClosingBundleUrl(d.id);
    } catch {
      (payload as any).closing_package_url = null;
    }

    let ref: string | null = null;
    let channel: "api" | "email" = "email";

    const apiUrl = process.env.TITLE_API_WEBHOOK_URL;
    if (apiUrl) {
      try {
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.TITLE_API_KEY
              ? { Authorization: `Bearer ${process.env.TITLE_API_KEY}` }
              : {}),
          },
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        if (res.ok) {
          channel = "api";
          try {
            ref = (JSON.parse(text)?.order_id as string) ?? null;
          } catch {
            ref = null;
          }
        } else {
          console.error(`[title-order] api failed [${res.status}]: ${text.slice(0, 300)}`);
        }
      } catch (e) {
        console.error("[title-order] api transport error", e);
      }
    }

    if (channel === "email") {
      try {
        const { sendM2MEmail, jsonBlock, assetHeaders } = await import("@/lib/email.server");
        await sendM2MEmail({
          to: TITLE_DESK_EMAIL,
          subject: `TITLE ORDER — ${d.address ?? "Parcel"} (${d.zip ?? "—"}) — Deal ${String(d.id).slice(0, 8)}`,
          html: `
            <h2>Automated Title &amp; Escrow Order</h2>
            <p>Trigger: <strong>${trigger}</strong></p>
            <p>Please open title, run a municipal lien search, and return the commitment plus closing package.</p>
            ${jsonBlock(payload)}
          `,
          headers: assetHeaders({
            assetId: d.id,
            dealType: d.asset_type ?? "LAND",
            assignmentFee: fee,
            action: "TITLE_ORDER",
          }),
        });
      } catch (e) {
        console.error("[title-order] email dispatch failed", e);
      }
    }

    await supabaseAdmin
      .from("title_packages")
      .upsert(
        {
          pipeline_item_id: d.id,
          package_status: "Generated" as never,
          title_company_ref: ref ?? TITLE_DESK_EMAIL,
          payload: payload as never,
        } as never,
        { onConflict: "pipeline_item_id" },
      );

    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        title_ordered_at: new Date().toISOString(),
        title_order_ref: ref ?? TITLE_DESK_EMAIL,
      } as never)
      .eq("id", d.id);

    return { ordered: true, ref: ref ?? TITLE_DESK_EMAIL, channel };
  } catch (e) {
    console.error("[title-order] failed", e);
    return { ordered: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
