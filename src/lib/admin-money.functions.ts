import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: {
  supabase: any;
  userId: string;
}) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

export type EscrowCapital = {
  total_capital: number;
  package_count: number;
  by_status: { Queued: number; Built: number; Sent: number };
};

export const getEscrowBoundCapital = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EscrowCapital> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("title_packages")
      .select(
        "package_status, closing_pipeline_items!inner(base_contract_price, optimized_acquisition_premium)"
      )
      .in("package_status", ["Queued", "Built", "Sent"]);
    if (error) throw new Error(error.message);

    const by_status = { Queued: 0, Built: 0, Sent: 0 };
    let total = 0;
    for (const row of data ?? []) {
      const status = row.package_status as keyof typeof by_status;
      if (status in by_status) by_status[status]++;
      const item: any = (row as any).closing_pipeline_items;
      const base = Number(item?.base_contract_price ?? 0);
      const prem = Number(item?.optimized_acquisition_premium ?? 0);
      total += base + prem;
    }
    return {
      total_capital: total,
      package_count: data?.length ?? 0,
      by_status,
    };
  });

export type TelemetryRow = {
  id: string;
  dispatched_at: string;
  endpoint_name: string;
  http_status: number | null;
  latency_ms: number | null;
  success: boolean;
  error_text: string | null;
};

export const getTransmissionTelemetry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TelemetryRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("routing_dispatch_log")
      .select(
        "id, dispatched_at, http_status, latency_ms, success, error_text, routing_endpoints!inner(name)"
      )
      .order("dispatched_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      dispatched_at: r.dispatched_at,
      endpoint_name: r.routing_endpoints?.name ?? "unknown",
      http_status: r.http_status,
      latency_ms: r.latency_ms,
      success: r.success,
      error_text: r.error_text,
    }));
  });

export type StallRow = {
  pipeline_item_id: string;
  zip: string;
  base_contract_price: number;
  hours_since_handshake: number;
  package_status: string;
};

export const getStallWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StallRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("title_packages")
      .select(
        "pipeline_item_id, package_status, updated_at, closing_pipeline_items!inner(zip, base_contract_price)"
      )
      .lt("updated_at", cutoff)
      .neq("package_status", "Acknowledged");
    if (error) throw new Error(error.message);
    const now = Date.now();
    return (data ?? []).map((r: any) => ({
      pipeline_item_id: r.pipeline_item_id,
      zip: r.closing_pipeline_items?.zip ?? "—",
      base_contract_price: Number(
        r.closing_pipeline_items?.base_contract_price ?? 0
      ),
      hours_since_handshake: Math.floor(
        (now - new Date(r.updated_at).getTime()) / 3_600_000
      ),
      package_status: r.package_status,
    }));
  });
