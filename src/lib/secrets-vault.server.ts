// Server-only credential vault. Values live in the service-role-only
// `app_secrets` table (no anon/authenticated grants, RLS on, zero policies)
// or in the platform environment. Values are never returned to the client.

export const MANAGED_SECRETS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const;
export type ManagedSecret = (typeof MANAGED_SECRETS)[number];

export async function readSecret(name: string): Promise<string | null> {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("app_secrets")
      .select("value")
      .eq("name", name)
      .maybeSingle();
    if (error || !data?.value) return null;
    return String(data.value);
  } catch {
    return null;
  }
}

export async function writeSecret(
  name: string,
  value: string,
  updatedBy: string | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("app_secrets")
      .upsert(
        { name, value, updated_by: updatedBy, updated_at: new Date().toISOString() },
        { onConflict: "name" },
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function secretStatus(): Promise<
  Array<{ name: string; configured: boolean; source: "env" | "vault" | null; updated_at: string | null }>
> {
  let rows: Array<{ name: string; updated_at: string }> = [];
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("app_secrets")
      .select("name, updated_at")
      .in("name", MANAGED_SECRETS as unknown as string[]);
    rows = (data ?? []) as any;
  } catch {
    rows = [];
  }
  return MANAGED_SECRETS.map((name) => {
    const row = rows.find((r) => r.name === name);
    const inEnv = Boolean(process.env[name]);
    return {
      name,
      configured: inEnv || Boolean(row),
      source: inEnv ? ("env" as const) : row ? ("vault" as const) : null,
      updated_at: row?.updated_at ?? null,
    };
  });
}
