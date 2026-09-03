import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TerminalDeal = {
  id: string;
  zip: string | null;
  asset_type: string | null;
  status: string | null;
  reverse_strike_ready: boolean;
  base_contract_price: number | null;
  calculated_arv: number | null;
  estimated_repairs: number | null;
  optimized_acquisition_premium: number | null;
  acreage: number | null;
  has_timber: boolean | null;
  timber_density_score: number | null;
  estimated_stumpage_mbf: number | null;
  exchange_deadline_at: string | null;
  m2m_expires_at: string | null;
  lock_phase: string | null;
  wire_instructed_at: string | null;
  updated_at: string | null;
};

export type TerminalBuyer = {
  id: string;
  label: string | null;
  legal_name: string | null;
  persona: string;
  active: boolean;
  is_1031_buyer: boolean;
  capital_to_deploy_usd: number;
  target_zip_codes: string[];
  irs_identification_deadline: string | null;
  exchange_deadline_at: string | null;
  urgency_score: number;
};

export type TerminalErrorLog = {
  id: string;
  route: string;
  severity: string;
  message: string;
  created_at: string;
};

export type Terminal1031Snapshot = {
  at: string;
  deals: TerminalDeal[];
  buyers: TerminalBuyer[];
  errors: TerminalErrorLog[];
};

const DEAL_COLS =
  "id,zip,asset_type,status,reverse_strike_ready,base_contract_price,calculated_arv,estimated_repairs,optimized_acquisition_premium,acreage,has_timber,timber_density_score,estimated_stumpage_mbf,exchange_deadline_at,m2m_expires_at,lock_phase,wire_instructed_at,updated_at";

/** Operator snapshot for the 1031 commercial terminal. Blind by construction:
 *  no address, city, APN or seller contact is ever projected. */
export const get1031Terminal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Terminal1031Snapshot> => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [dealsRes, buyersRes, errRes] = await Promise.all([
      supabaseAdmin
        .from("closing_pipeline_items")
        .select(DEAL_COLS)
        .order("updated_at", { ascending: false })
        .limit(400),
      supabaseAdmin
        .from("buyer_buy_boxes")
        .select(
          "id,label,legal_name,persona,active,is_1031_buyer,capital_to_deploy_usd,target_zip_codes,irs_identification_deadline,exchange_deadline_at,urgency_score",
        )
        .eq("active", true)
        .limit(200),
      supabaseAdmin
        .from("system_error_logs")
        .select("id,route,severity,message,created_at")
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

    return {
      at: new Date().toISOString(),
      deals: (dealsRes.data ?? []) as TerminalDeal[],
      buyers: (buyersRes.data ?? []) as TerminalBuyer[],
      errors: (errRes.data ?? []) as TerminalErrorLog[],
    };
  });
