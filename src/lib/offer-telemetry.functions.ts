// Outbound offer delivery, engagement & rejection telemetry.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "@/lib/require-admin";

export const REJECTION_CODES = [
  "YIELD_BELOW_HURDLE",
  "LIEN_THRESHOLD_EXCEEDED",
  "GEO_OUT_OF_BOUNDS",
  "EMD_RAIL_MISMATCH",
  "CAPITAL_SATURATED",
  "CUSTOM_OTHER",
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export const REJECTION_LABELS: Record<RejectionCode, string> = {
  YIELD_BELOW_HURDLE: "Yield below hurdle rate",
  LIEN_THRESHOLD_EXCEEDED: "Lien / encumbrance too high",
  GEO_OUT_OF_BOUNDS: "ZIP outside buy-box perimeter",
  EMD_RAIL_MISMATCH: "EMD wire rail mismatch",
  CAPITAL_SATURATED: "Capital reserves saturated",
  CUSTOM_OTHER: "Other",
};

export const logOfferEvent = createServerFn({ method: "POST" })
  .inputValidator((d: { contractId: string; status: "OPENED" | "CLICKED" | "DELIVERED" | "EXECUTED"; meta?: Record<string, unknown> }) => d)
  .handler(async ({ data }) => {
    try {
      const { getRequestHeader } = await import("@tanstack/react-start/server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("offer_delivery_logs").insert({
        contract_id: data.contractId,
        status: data.status,
        user_agent: getRequestHeader("user-agent") ?? null,
        ip_address:
          (getRequestHeader("cf-connecting-ip") ||
            getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim()) ?? null,
        meta: (data.meta ?? {}) as never,
      } as never);
    } catch (e) {
      console.error("[offer-telemetry] log failed", e);
    }
    return { ok: true };
  });

// Public buyer action: invoked from the unauthenticated /sign/$id closing page.
export const rejectOffer = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { id: string; code: RejectionCode; targetPrice?: number | null; note?: string | null }) => d,
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("reject_offer" as never, {
      _id: data.id,
      _code: data.code,
      _target_price: data.targetPrice ?? null,
      _note: data.note ?? null,
      _source: "ui",
    } as never);
    if (error) return { ok: false, error: error.message };
    return res as { ok: boolean; recascaded_to?: string | null };
  });

export type OfferTelemetry = {
  sent: number;
  opened: number;
  clicked: number;
  rejected: number;
  executed: number;
  reasons: { code: string; n: number }[];
};

export const getOfferTelemetry = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OfferTelemetry> => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.rpc("offer_telemetry_summary" as never);
    const d = (data ?? {}) as Partial<OfferTelemetry>;
    return {
      sent: Number(d.sent ?? 0),
      opened: Number(d.opened ?? 0),
      clicked: Number(d.clicked ?? 0),
      rejected: Number(d.rejected ?? 0),
      executed: Number(d.executed ?? 0),
      reasons: (d.reasons ?? []) as { code: string; n: number }[],
    };
  },
);

export type DeliveryAuditRow = {
  id: string;
  created_at: string;
  recipient_email: string | null;
  subject: string | null;
  status: string;
  contract_id: string | null;
  provider_message_id: string | null;
};

export const getDeliveryAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeliveryAuditRow[]> => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("offer_delivery_logs")
      .select("id, created_at, recipient_email, subject, status, contract_id, provider_message_id")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("[offer-telemetry] audit fetch failed", error.message);
      return [];
    }
    return (data ?? []) as DeliveryAuditRow[];
  },
);
