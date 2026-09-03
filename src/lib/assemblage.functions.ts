import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";

export type AssemblageGroup = {
  group_id: string;
  owner_entity: string | null;
  zip: string | null;
  deal_count: number;
  combined_sqft: number;
  combined_basis: number;
  combined_fee: number;
};

export type AssemblageSnapshot = {
  generated_at: string;
  groups: AssemblageGroup[];
  tag_counts: Record<string, number>;
};

export const getAssemblageSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AssemblageSnapshot> => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Refresh groups (idempotent), then read snapshot
    await supabaseAdmin.rpc("detect_assemblage_groups");
    const { data, error } = await supabaseAdmin.rpc("assemblage_radar_snapshot");
    if (error) throw error;
    return (data ?? { generated_at: new Date().toISOString(), groups: [], tag_counts: {} }) as AssemblageSnapshot;
  });
