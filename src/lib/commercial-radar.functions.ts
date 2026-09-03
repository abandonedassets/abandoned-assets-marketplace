import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";

export type AssemblageCluster = {
  zip: string | null;
  owner_entity: string | null;
  zoning_category: string | null;
  lot_count: number;
  combined_basis: number;
  combined_fee: number;
  combined_sqft: number;
};

export type CommercialRadar = {
  generated_at: string;
  channel_counts: Record<string, number>;
  zoning_counts: Record<string, number>;
  env_quarantined: number;
  dual_yield: number;
  clusters: AssemblageCluster[];
};

export const getCommercialRadar = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CommercialRadar> => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("commercial_assemblage_radar");
    if (error) throw new Error(error.message);
    return (data ?? {
      generated_at: new Date().toISOString(),
      channel_counts: {},
      zoning_counts: {},
      env_quarantined: 0,
      dual_yield: 0,
      clusters: [],
    }) as CommercialRadar;
  });

export type ShieldedAsset = {
  id: string;
  address: string | null;
  zip: string | null;
  zoning_category: string | null;
  buyer_channel: string | null;
  env_status: string | null;
  env_flag_reason: string | null;
  adjacent_parcel_count: number;
  msa_distance_miles: number | null;
  optimized_acquisition_premium: number | null;
  target_vault: string | null;
  enrichment_tags: string[];
};

export const getShieldedAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ShieldedAsset[]> => {
    const { data, error } = await context.supabase
      .from("closing_pipeline_items")
      .select(
        "id, address, zip, zoning_category, buyer_channel, env_status, env_flag_reason, adjacent_parcel_count, msa_distance_miles, optimized_acquisition_premium, target_vault, enrichment_tags",
      )
      .not("status", "in", '("Closed","Dead")')
      .order("optimized_acquisition_premium", { ascending: false })
      .limit(150);
    if (error) throw new Error(error.message);
    return ((data ?? []) as ShieldedAsset[]).map((r) => ({
      ...r,
      enrichment_tags: r.enrichment_tags ?? [],
      adjacent_parcel_count: r.adjacent_parcel_count ?? 0,
    }));
  });
