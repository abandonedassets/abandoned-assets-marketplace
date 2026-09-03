import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OpsHealth = {
  dlq_count: number;
  dlq_ok: boolean;
  exception_count: number;
  config_keys: number;
  in_escrow_7d: number;
  in_escrow_total: number;
};

export const getOpsHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OpsHealth> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const [dlq, exc, cfg, esc7, escAll] = await Promise.all([
      supabaseAdmin.from("dead_letter_queue").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("exception_queue")
        .select("id", { count: "exact", head: true })
        .is("resolved_at", null),
      supabaseAdmin.from("system_config").select("key", { count: "exact", head: true }),
      supabaseAdmin
        .from("closing_pipeline_items")
        .select("id", { count: "exact", head: true })
        .eq("status", "In-Escrow")
        .gte("updated_at", since),
      supabaseAdmin
        .from("closing_pipeline_items")
        .select("id", { count: "exact", head: true })
        .eq("status", "In-Escrow"),
    ]);

    const dlqCount = dlq.count ?? 0;
    return {
      dlq_count: dlqCount,
      dlq_ok: dlqCount < 10,
      exception_count: exc.count ?? 0,
      config_keys: cfg.count ?? 0,
      in_escrow_7d: esc7.count ?? 0,
      in_escrow_total: escAll.count ?? 0,
    };
  });

export type LedgerSummary = {
  open_ledgers: number;
  total_assignment_fee: number;
  amount_secured: number;
  amount_released: number;
  pending_release: number;
};

export const getLedgerSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LedgerSummary> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data, error } = await context.supabase
      .from("shadow_escrow_ledger")
      .select("total_assignment_fee,amount_secured,amount_released,liquidity_state")
      .limit(5000);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as any[];
    const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    const secured = sum("amount_secured");
    const released = sum("amount_released");
    return {
      open_ledgers: rows.filter((r) => r.liquidity_state !== "COMPLETE").length,
      total_assignment_fee: sum("total_assignment_fee"),
      amount_secured: secured,
      amount_released: released,
      pending_release: Math.max(0, secured - released),
    };
  });
