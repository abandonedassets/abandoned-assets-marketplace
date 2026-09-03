import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";

export type Bundle = {
  id: string;
  name: string;
  region_tag: string | null;
  total_base: number;
  total_fee: number;
  total_arv: number;
  deal_count: number;
  status: string;
  reserved_for_fund: string | null;
  soft_lock_until: string | null;
  updated_at: string;
};

export type BundleWithDeals = Bundle & {
  deals: Array<{
    id: string;
    zip: string;
    base_contract_price: number;
    optimized_acquisition_premium: number;
    status: string;
  }>;
};

const ACTIVE_STATUSES = [
  "New",
  "Under-Review",
  "Seller-Signed",
  "Buyer-Signed",
  "In-Escrow",
] as const;

export const listBundles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ bundles: BundleWithDeals[] }> => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: bundles } = await supabaseAdmin
      .from("bundles")
      .select("*")
      .order("updated_at", { ascending: false });
    const { data: deals } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id, zip, base_contract_price, optimized_acquisition_premium, status, bundle_id, is_held",
      )
      .not("bundle_id", "is", null)
      .eq("is_held", false);

    const byBundle = new Map<string, any[]>();
    for (const d of deals ?? []) {
      const k = (d as any).bundle_id as string;
      if (!byBundle.has(k)) byBundle.set(k, []);
      byBundle.get(k)!.push({
        id: d.id,
        zip: d.zip,
        base_contract_price: Number(d.base_contract_price) || 0,
        optimized_acquisition_premium:
          Number(d.optimized_acquisition_premium) || 0,
        status: d.status,
      });
    }

    return {
      bundles: (bundles ?? []).map((b: any) => ({
        id: b.id,
        name: b.name,
        region_tag: b.region_tag,
        total_base: Number(b.total_base) || 0,
        total_fee: Number(b.total_fee) || 0,
        total_arv: Number(b.total_arv) || 0,
        deal_count: b.deal_count ?? 0,
        status: b.status,
        reserved_for_fund: b.reserved_for_fund,
        soft_lock_until: b.soft_lock_until,
        updated_at: b.updated_at,
        deals: byBundle.get(b.id) ?? [],
      })),
    };
  });

/** Auto-bundle: group unbundled active deals by ZIP3 region, min 2 deals per bundle */
export const runAutoBundler = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ created: number; assigned: number }> => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: deals, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id, zip")
      .is("bundle_id", null)
      .eq("is_held", false)
      .in("status", [...ACTIVE_STATUSES]);

    if (error || !deals?.length) return { created: 0, assigned: 0 };

    const groups = new Map<string, string[]>();
    for (const d of deals) {
      const zip3 = (d.zip ?? "").slice(0, 3) || "000";
      if (!groups.has(zip3)) groups.set(zip3, []);
      groups.get(zip3)!.push(d.id);
    }

    let created = 0;
    let assigned = 0;
    for (const [zip3, ids] of groups) {
      if (ids.length < 2) continue;
      const { data: bundle, error: bErr } = await supabaseAdmin
        .from("bundles")
        .insert({
          name: `Region ${zip3}xx SFR Bundle`,
          region_tag: zip3,
          status: "active",
        })
        .select("id")
        .single();
      if (bErr || !bundle) continue;
      created++;
      const { error: uErr } = await supabaseAdmin
        .from("closing_pipeline_items")
        .update({ bundle_id: bundle.id })
        .in("id", ids);
      if (!uErr) assigned += ids.length;
    }
    return { created, assigned };
  });

/** Retail "Hold" — instantly detaches a deal from any bundle (trigger handles totals). */
export const holdDeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { deal_id: string; hours?: number }) => d)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const hours = Math.min(Math.max(data.hours ?? 2, 1), 24);
    const heldUntil = new Date(Date.now() + hours * 3600_000).toISOString();
    const { error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .update({ is_held: true, held_until: heldUntil })
      .eq("id", data.deal_id);
    if (error) throw new Error(error.message);
    return { ok: true, held_until: heldUntil };
  });
