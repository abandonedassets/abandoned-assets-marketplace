import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PersonaKey =
  | "EXCHANGE_1031"
  | "CONVERSION_1033"
  | "QOZ_FUND"
  | "BONUS_DEPRECIATION"
  | "SDIRA_CASH"
  | "TIMO_SAWMILL"
  | "DRY_POWDER"
  | "HARD_MONEY_RECYCLER"
  | "ADJACENT_OWNER"
  | "BTR_INFILL"
  | "GENERIC";

export const PERSONA_LABELS: Record<PersonaKey, string> = {
  EXCHANGE_1031: "1031 Forward/Reverse Exchange",
  CONVERSION_1033: "1033 Involuntary Conversion",
  QOZ_FUND: "Opportunity Zone Fund",
  BONUS_DEPRECIATION: "168(k) Depreciation Rush",
  SDIRA_CASH: "SDIRA / Solo 401(k) Cash",
  TIMO_SAWMILL: "TIMO / Sawmill Procurement",
  DRY_POWDER: "PE Dry-Powder Quota",
  HARD_MONEY_RECYCLER: "Hard-Money Recycler",
  ADJACENT_OWNER: "Adjacent Parcel Owner",
  BTR_INFILL: "BTR / Infill Assembler",
  GENERIC: "Generic Buyer",
};

export type RadarBuyer = {
  id: string;
  label: string | null;
  persona: PersonaKey;
  urgency_score: number;
  capital_to_deploy_usd: number;
  window_expiration: string | null;
  days_left: number | null;
  target_zip_codes: string[];
  target_asset_types: string[];
  max_contract_price: number;
  min_placement_margin: number;
  final_stretch: boolean;
};

export type VaultBucket = {
  vault: string;
  deal_count: number;
  fee_usd: number;
  stumpage_mbf: number;
};

export type RadarSummary = {
  buyers: RadarBuyer[];
  vaults: VaultBucket[];
  kill_switch: boolean;
  manual_pending: number;
};

export const getBuyerRadar = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<RadarSummary> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: boxes }, { data: deals }, { data: cfg }] = await Promise.all([
      supabaseAdmin
        .from("buyer_buy_boxes")
        .select(
          "id, label, persona, urgency_score, capital_to_deploy_usd, window_expiration, target_zip_codes, target_asset_types, max_contract_price, min_placement_margin, active",
        )
        .eq("active", true)
        .order("urgency_score", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("closing_pipeline_items")
        .select(
          "target_vault, optimized_acquisition_premium, estimated_stumpage_mbf, autopilot_state, status",
        )
        .not("status", "in", '("Closed","Dead")'),
      supabaseAdmin
        .from("system_config")
        .select("value")
        .eq("key", "SYSTEM_KILL_SWITCH")
        .maybeSingle(),
    ]);

    const now = Date.now();
    const buyers: RadarBuyer[] = ((boxes ?? []) as Record<string, unknown>[]).map((b) => {
      const exp = (b["window_expiration"] as string | null) ?? null;
      const days = exp ? Math.ceil((new Date(exp).getTime() - now) / 86_400_000) : null;
      return {
        id: String(b["id"]),
        label: (b["label"] as string | null) ?? null,
        persona: ((b["persona"] as PersonaKey) ?? "GENERIC"),
        urgency_score: Number(b["urgency_score"] ?? 0),
        capital_to_deploy_usd: Number(b["capital_to_deploy_usd"] ?? 0),
        window_expiration: exp,
        days_left: days,
        target_zip_codes: (b["target_zip_codes"] as string[]) ?? [],
        target_asset_types: (b["target_asset_types"] as string[]) ?? [],
        max_contract_price: Number(b["max_contract_price"] ?? 0),
        min_placement_margin: Number(b["min_placement_margin"] ?? 0),
        final_stretch: days !== null && days <= 15 && days >= 0,
      };
    });

    const map = new Map<string, VaultBucket>();
    let manual_pending = 0;
    for (const d of ((deals ?? []) as Record<string, unknown>[])) {
      const vault = (d["target_vault"] as string | null) ?? "unrouted";
      const v = map.get(vault) ?? { vault, deal_count: 0, fee_usd: 0, stumpage_mbf: 0 };
      v.deal_count += 1;
      v.fee_usd += Number(d["optimized_acquisition_premium"] ?? 0);
      v.stumpage_mbf += Number(d["estimated_stumpage_mbf"] ?? 0);
      map.set(vault, v);
      if (d["autopilot_state"] === "Manual") manual_pending += 1;
    }

    const kv = (cfg as { value?: unknown } | null)?.value;

    return {
      buyers: buyers.sort((a, b) => {
        if (a.final_stretch !== b.final_stretch) return a.final_stretch ? -1 : 1;
        return b.urgency_score - a.urgency_score;
      }),
      vaults: Array.from(map.values()).sort((a, b) => b.fee_usd - a.fee_usd),
      kill_switch: kv === true || kv === "true",
      manual_pending,
    };
  });

export const setKillSwitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { on: boolean }) => ({ on: Boolean(input?.on) }))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("system_config")
      .upsert(
        { key: "SYSTEM_KILL_SWITCH", value: data.on as never, updated_at: new Date().toISOString() } as never,
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    return { ok: true as const, on: data.on };
  });
