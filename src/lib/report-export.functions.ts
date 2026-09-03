import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const exportDealReportPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number } | undefined) => ({
    limit: Math.min(Math.max(input?.limit ?? 200, 1), 1000),
  }))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id, zip, status, base_contract_price, optimized_acquisition_premium, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);

    const { renderDealReportPdf } = await import("./report-pdf.server");
    const { bytes, checksum } = await renderDealReportPdf((rows ?? []) as never);

    let binary = "";
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i]!);

    return {
      filename: `deal-summary-${new Date().toISOString().slice(0, 10)}.pdf`,
      checksum,
      row_count: rows?.length ?? 0,
      base64: btoa(binary),
    };
  });
