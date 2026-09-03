import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PipelineItem = {
  id: string;
  external_id: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  zip: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lot_sqft: number | null;
  year_built: number | null;
  base_contract_price: number | null;
  optimized_acquisition_premium: number | null;
  status: string | null;
  source: string | null;
  asset_type: string | null;
  zoning_class: string | null;
  enrichment_tags: string[] | null;
  is_stale: boolean | null;
  is_held: boolean | null;
  notification_queued: boolean | null;
  payout_status: string | null;
  payout_at: string | null;
  signed_contract_hash: string | null;
  verified_counterparty_id: string | null;
  title_escrow_file_number: string | null;
  created_at: string;
};

const COLS =
  "id,external_id,address,city,state,county,zip,beds,baths,sqft,lot_sqft,year_built,base_contract_price,optimized_acquisition_premium,status,source,asset_type,zoning_class,enrichment_tags,is_stale,is_held,notification_queued,payout_status,payout_at,signed_contract_hash,verified_counterparty_id,title_escrow_file_number,created_at";

export const listPipelineItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("closing_pipeline_items")
      .select(COLS)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PipelineItem[];
  });

/** Mass liquidation blast — flips selected rows to Webhook_Dispatched so Postgres triggers fire payloads. */
export const executeLiquidationBlast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ids: string[] }) => {
    const ids = Array.isArray(d?.ids) ? d.ids.filter(Boolean) : [];
    if (ids.length === 0) throw new Error("no_rows_selected");
    return { ids: ids.slice(0, 500) };
  })
  .handler(async ({ data, context }) => {
    const { error, count } = await context.supabase
      .from("closing_pipeline_items")
      .update({ status: "Webhook_Dispatched" } as never, { count: "exact" })
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { ok: true as const, dispatched: count ?? data.ids.length };
  });

/** Cloud-native notification: queue only, no SMS/phone. */
export const queueNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d?.id) throw new Error("invalid_id");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("closing_pipeline_items")
      .update({ notification_queued: true } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const, id: data.id };
  });

/** Dead-deal off-ramp: convert to a Net Listing Option Agreement. */
export const convertToOption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d?.id) throw new Error("invalid_id");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("closing_pipeline_items")
      .update({ status: "Shadow_Inventory" } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const, id: data.id };
  });

/** Full record for PDF generation (site sheet / mutual release). */
export const getAssetRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d?.id) throw new Error("invalid_id");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("closing_pipeline_items")
      .select(COLS + ",apn,owner_entity,assessed_value,annual_property_tax,lien_total")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("not_found");
    return row as unknown as Record<string, string | number | boolean | string[] | null>;
  });
