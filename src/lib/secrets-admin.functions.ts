import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ALLOWED = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"];

async function assertAdmin(ctx: any) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

/** Configured / Not Configured status only — never returns any value. */
export const getSecretStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { secretStatus } = await import("./secrets-vault.server");
    return await secretStatus();
  });

/** Store a gateway credential in server-side storage. */
export const setAdminSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; value: string }) => {
    if (!d || !ALLOWED.includes(d.name)) throw new Error("unsupported_secret");
    const value = (d.value ?? "").trim();
    if (value.length < 8 || value.length > 512) throw new Error("invalid_value");
    return { name: d.name, value };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { writeSecret } = await import("./secrets-vault.server");
    const res = await writeSecret(data.name, data.value, context.userId);
    if (!res.ok) throw new Error(res.error ?? "save_failed");
    return { ok: true as const, name: data.name };
  });
