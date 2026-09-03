import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CONFIG_KEY = "sms_alerts";

export type AlertConfig = {
  enabled: boolean;
  phone: string;
  min_fee_usd: number;
  twilio_configured: boolean;
};

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

export const getAlertConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AlertConfig> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { twilioConfigured } = await import("@/lib/alerts.server");
    const { data } = await supabaseAdmin
      .from("system_config")
      .select("value")
      .eq("key", CONFIG_KEY)
      .maybeSingle();
    const v = ((data as any)?.value ?? {}) as Record<string, any>;
    return {
      enabled: Boolean(v.enabled),
      phone: String(v.phone ?? ""),
      min_fee_usd: Number(v.min_fee_usd ?? 0),
      twilio_configured: twilioConfigured(),
    };
  });

export const setAlertConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { enabled: boolean; phone: string; min_fee_usd: number }) => ({
    enabled: Boolean(d.enabled),
    phone: String(d.phone ?? "").trim().slice(0, 20),
    min_fee_usd: Math.max(0, Math.floor(Number(d.min_fee_usd) || 0)),
  }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("system_config")
      .upsert(
        { key: CONFIG_KEY, value: data as never, updated_at: new Date().toISOString() } as never,
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const sendTestPing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendSms } = await import("@/lib/alerts.server");
    const { data } = await supabaseAdmin
      .from("system_config")
      .select("value")
      .eq("key", CONFIG_KEY)
      .maybeSingle();
    const phone = String(((data as any)?.value ?? {}).phone ?? "");
    return sendSms(phone, "AbandonedAssetsOS :: test ping. Escrow-lock alerts are wired.");
  });

/** Fire an escrow-lock alert if enabled and the fee clears the threshold. Never throws. */
export const pingEscrowLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d?.id) throw new Error("invalid_id");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { sendSms } = await import("@/lib/alerts.server");
      const [{ data: cfgRow }, { data: deal }] = await Promise.all([
        supabaseAdmin.from("system_config").select("value").eq("key", CONFIG_KEY).maybeSingle(),
        supabaseAdmin
          .from("closing_pipeline_items")
          .select("id,address,zip,status,optimized_acquisition_premium")
          .eq("id", data.id)
          .maybeSingle(),
      ]);
      const cfg = ((cfgRow as any)?.value ?? {}) as Record<string, any>;
      if (!cfg.enabled) return { ok: false, status: "disabled" };
      const fee = Number((deal as any)?.optimized_acquisition_premium ?? 0);
      if (fee < Number(cfg.min_fee_usd ?? 0)) return { ok: false, status: "below_threshold" };
      return await sendSms(
        String(cfg.phone ?? ""),
        `ESCROW LOCK :: ${(deal as any)?.address ?? data.id.slice(0, 8)} (${(deal as any)?.zip ?? "—"}) · fee $${Math.round(fee).toLocaleString()} · status ${(deal as any)?.status ?? "—"}`,
      );
    } catch (e) {
      console.error("pingEscrowLock failed", e);
      return { ok: false, status: "error", detail: (e as Error).message };
    }
  });
