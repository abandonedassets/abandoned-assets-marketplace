// Masked, executable deal tape for the outbound institutional stream.
// Only pre-signature-safe fields leave the building (no house number, no GPS).

export type TapeAsset = {
  deal_id: string;
  parcel_id: string | null;
  asset_class: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  valuation: number;
  assignment_fee: number;
  arv: number | null;
  title_clean: boolean;
  title_clean_hash: string;
  status: string | null;
  tif_seconds: number;
  executable: boolean;
};

/** One snapshot of executable inventory (REVERSE_STRIKE_READY + open tape). */
export async function streamTick(limit = 100): Promise<TapeAsset[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { titleCleanHash, TIF_SECONDS } = await import("@/lib/m2m-protocol.server");

  const { data, error } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id, apn, parcel_number, county, state, zip, asset_class, asset_type, base_contract_price, optimized_acquisition_premium, calculated_arv, status, lien_total, title_status, assessed_value, is_dip, dip_case_number, dip_sale_motion_ref, dip_proposed_order_ref",
    )
    .is("cleared_at", null)
    .not("status", "in", '("Dead","Rejected","Closed","Auto_Archived_Bad_Data")')
    .gt("optimized_acquisition_premium", 0)
    .order("optimized_acquisition_premium", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, any>[]).map((r) => {
    const title = titleCleanHash({
      apn: r["apn"],
      county: r["county"],
      lien_total: r["lien_total"],
      title_status: r["title_status"],
      assessed_value: r["assessed_value"],
      is_dip: r["is_dip"],
      dip_case_number: r["dip_case_number"],
      dip_sale_motion_ref: r["dip_sale_motion_ref"],
      dip_proposed_order_ref: r["dip_proposed_order_ref"],
    });
    return {
      deal_id: String(r["id"]),
      parcel_id: null,
      asset_class: r["asset_class"] ?? r["asset_type"] ?? null,
      state: r["state"] ?? null,
      zip: r["zip"] ?? null,
      county: null,
      valuation: Number(r["base_contract_price"]) || 0,
      assignment_fee: Number(r["optimized_acquisition_premium"]) || 0,
      arv: r["calculated_arv"] == null ? null : Number(r["calculated_arv"]),
      title_clean: title.title_clean,
      title_clean_hash: title.title_clean_hash,
      status: r["status"] ?? null,
      tif_seconds: TIF_SECONDS,
      executable: true,
    };
  });
}
