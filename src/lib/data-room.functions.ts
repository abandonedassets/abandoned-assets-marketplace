// Institutional Data Room server functions (admin-only).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DataRoomDeal = {
  id: string;
  parcel_id: string | null;
  address: string | null;
  state: string | null;
  zip: string | null;
  asset_class: string | null;
  valuation: number;
  fee: number;
  status: string;
  verification_status: string | null;
  title_clean_hash: string | null;
  is_dip: boolean;
  has_street_utilities: boolean;
  source_system: string | null;
  fee_attribution: string | null;
};

export type DataRoomSnapshot = {
  deals: DataRoomDeal[];
  escrow_inventory_usd: number;
  deal_count: number;
  webhook_url: string | null;
};

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

export const getDataRoomSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DataRoomSnapshot> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: rows }, { data: cfg }] = await Promise.all([
      supabaseAdmin
        .from("closing_pipeline_items")
        .select(
          "id, apn, parcel_number, address, state, zip, asset_class, asset_type, base_contract_price, optimized_acquisition_premium, status, verification_status, m2m_asset_hash, is_dip, has_street_utilities, source_system, fee_attribution",
        )
        .is("cleared_at", null)
        .order("base_contract_price", { ascending: false })
        .limit(500),
      supabaseAdmin
        .from("system_config")
        .select("value")
        .eq("key", "ledger_webhook_url")
        .maybeSingle(),
    ]);

    const deals: DataRoomDeal[] = ((rows ?? []) as any[]).map((r) => ({
      id: r.id,
      parcel_id: r.parcel_number ?? r.apn ?? null,
      address: r.address ?? null,
      state: r.state ?? null,
      zip: r.zip ?? null,
      asset_class: r.asset_class ?? r.asset_type ?? null,
      valuation: Number(r.base_contract_price) || 0,
      fee: Number(r.optimized_acquisition_premium) || 0,
      status: String(r.status ?? "").toUpperCase().replace(/-/g, "_"),
      verification_status: r.verification_status ?? null,
      title_clean_hash: r.m2m_asset_hash ?? null,
      is_dip: !!r.is_dip,
      has_street_utilities: !!r.has_street_utilities,
      source_system: r.source_system ?? null,
      fee_attribution: r.fee_attribution ?? null,
    }));

    return {
      deals,
      deal_count: deals.length,
      escrow_inventory_usd: deals.reduce((s, d) => s + d.valuation, 0),
      webhook_url:
        (cfg as any)?.value?.url ??
        (typeof (cfg as any)?.value === "string" ? (cfg as any).value : null),
    };
  });

export const setLedgerWebhookUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { url: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const url = data.url.trim();
    if (url && !/^https:\/\//i.test(url)) throw new Error("Webhook URL must be https://");
    // Google Apps Script webhooks only accept POST on the /exec deployment path.
    const normalized =
      /script\.google\.com\/macros\//i.test(url) && !/\/(exec|dev)$/i.test(url)
        ? url.replace(/\/+$/, "") + "/exec"
        : url;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("system_config")
      .upsert(
        { key: "ledger_webhook_url", value: { url: normalized } as never, updated_at: new Date().toISOString() } as never,
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    return { ok: true, url: normalized };
  });

export type { SheetRow } from "@/lib/ledger-sync.server";

/**
 * Google Sheets ledger sync (manual override; the cloud worker runs the same
 * core automatically on DB events and every cycle).
 */
export const syncLedgerToSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d?: { mode?: "full" | "delta"; ids?: string[]; vaultCashUsd?: number }) => ({
    mode: d?.mode === "delta" ? ("delta" as const) : ("full" as const),
    ids: Array.isArray(d?.ids) ? d!.ids!.slice(0, 5000) : [],
    vaultCashUsd: Number(d?.vaultCashUsd) || 0,
  }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { runLedgerSync } = await import("@/lib/ledger-sync.server");
    return runLedgerSync(data);
  });
