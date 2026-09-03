import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const buyBoxSchema = z.object({
  label: z.string().trim().min(2).max(120),
  target_zip_codes: z.array(z.string().regex(/^\d{5}$/)).min(1).max(200),
  target_asset_types: z.array(z.string().trim().max(40)).min(1).max(20),
  max_contract_price: z.number().finite().min(1).max(500_000_000),
  min_placement_margin: z.number().finite().min(0).max(100),
  buyer_priority: z.enum(["standard", "priority", "institutional"]).default("standard"),
});

export type BuyBoxInput = z.infer<typeof buyBoxSchema>;

export const submitBuyBox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => buyBoxSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("buyer_buy_boxes").insert({
      buyer_id: context.userId,
      label: data.label,
      target_zip_codes: data.target_zip_codes,
      target_asset_types: data.target_asset_types,
      max_contract_price: data.max_contract_price,
      min_placement_margin: data.min_placement_margin,
      buyer_priority: data.buyer_priority,
      active: true,
    } as never);
    if (error) throw new Error(error.message);

    // Ensure the buyer has an app role row (enum: admin | moderator | user)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: context.userId, role: "user" } as never, {
        onConflict: "user_id,role",
      });

    return { ok: true as const };
  });

export const listMyBuyBoxes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("buyer_buy_boxes")
      .select(
        "id,label,target_zip_codes,target_asset_types,max_contract_price,min_placement_margin,buyer_priority,active,created_at",
      )
      .eq("buyer_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export type BuyBoxMatch = {
  id: string;
  label: string | null;
  buyer_priority: string | null;
  active: boolean;
  max_contract_price: number;
  min_placement_margin: number;
  target_zip_codes: string[];
  target_asset_types: string[];
  match_count: number;
  matched_premium: number;
};

// Admin view: active buy boxes scored against live pipeline assets.
export const listBuyBoxMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [boxes, assets] = await Promise.all([
      supabaseAdmin
        .from("buyer_buy_boxes")
        .select(
          "id,label,buyer_priority,active,max_contract_price,min_placement_margin,target_zip_codes,target_asset_types",
        )
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("closing_pipeline_items")
        .select("zip,asset_type,base_contract_price,optimized_acquisition_premium,liquidity_match_score")
        .limit(5000),
    ]);
    if (boxes.error) throw new Error(boxes.error.message);
    if (assets.error) throw new Error(assets.error.message);

    const rows = (assets.data ?? []) as any[];
    return ((boxes.data ?? []) as any[]).map((b) => {
      const zips: string[] = b.target_zip_codes ?? [];
      const types: string[] = b.target_asset_types ?? [];
      const hits = rows.filter(
        (a) =>
          (zips.length === 0 || zips.includes(a.zip)) &&
          (types.length === 0 || types.includes(a.asset_type)) &&
          Number(a.base_contract_price ?? 0) <= Number(b.max_contract_price ?? 0),
      );
      return {
        ...b,
        match_count: hits.length,
        matched_premium: hits.reduce(
          (s, a) => s + Number(a.optimized_acquisition_premium ?? 0),
          0,
        ),
      } as BuyBoxMatch;
    });
  });
