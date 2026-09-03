import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AuditLogRow = {
  id: string;
  event_type: string | null;
  reason: string;
  pipeline_item_id: string | null;
  llm_confidence_score: number | null;
  ip_address: string | null;
  created_at: string;
};

export const getImmutableAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data, error } = await context.supabase
      .from("system_audit_logs")
      .select(
        "id, event_type, reason, pipeline_item_id, llm_confidence_score, ip_address, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as AuditLogRow[];
  });
