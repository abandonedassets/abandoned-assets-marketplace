import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getInboundDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { inboundDiagnostics } = await import("@/lib/fbo.server");
    return await inboundDiagnostics();
  });

export const provisionInboundAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { provisionOpenDeals } = await import("@/lib/fbo.server");
    return await provisionOpenDeals();
  });

/** FBO account/routing pairs keyed by pipeline item id — used by the Master Terminal deal tape. */
export const listFboPairs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("inbound_wire_accounts")
      .select("pipeline_item_id,fbo_account_number,routing_number,status,expected_amount")
      .limit(2000);
    return (data ?? []) as Array<{
      pipeline_item_id: string;
      fbo_account_number: string;
      routing_number: string;
      status: string;
      expected_amount: number | null;
    }>;
  });
