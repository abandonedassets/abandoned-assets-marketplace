// Bluevine REST facility credentials.
// Resolution order: process.env (immutable secrets) -> system_config row
// written by the in-app connector form at /admin/banking.
// Never returns raw values to the browser — callers mask before responding.

export type BluevineRest = { base: string | null; key: string | null; source: "env" | "config" | "none" };

const CONFIG_KEY = "bluevine_rest";
let cache: BluevineRest | null = null;

export function invalidateBluevineRestCache() {
  cache = null;
}

export async function bluevineRest(): Promise<BluevineRest> {
  const envBase = process.env["BLUEVINE_API_BASE"] || null;
  const envKey = process.env["BLUEVINE_API_KEY"] || null;
  if (envBase && envKey) return { base: envBase, key: envKey, source: "env" };
  if (cache) return cache;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("system_config")
      .select("value")
      .eq("key", CONFIG_KEY)
      .maybeSingle();
    const v = (data?.value ?? null) as any;
    cache =
      v?.base && v?.key
        ? { base: String(v.base), key: String(v.key), source: "config" }
        : { base: null, key: null, source: "none" };
  } catch {
    cache = { base: null, key: null, source: "none" };
  }
  return cache;
}

export async function saveBluevineRest(base: string, key: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const clean = base.trim().replace(/\/$/, "");
  const { error } = await supabaseAdmin
    .from("system_config")
    .upsert(
      { key: CONFIG_KEY, value: { base: clean, key: key.trim() } as any, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  invalidateBluevineRestCache();
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function clearBluevineRest() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("system_config").delete().eq("key", CONFIG_KEY);
  invalidateBluevineRestCache();
  return { ok: true as const };
}

/** Live authentication probe against the Bluevine REST facility. */
export async function pingBluevine(): Promise<{
  ok: boolean;
  status?: number;
  detail?: string;
}> {
  const rest = await bluevineRest();
  if (!rest.base || !rest.key) return { ok: false, detail: "credentials_missing" };
  try {
    const res = await fetch(`${rest.base.replace(/\/$/, "")}/v1/account`, {
      method: "GET",
      headers: { Authorization: `Bearer ${rest.key}`, Accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, detail: "authentication_rejected" };
    }
    return { ok: res.ok, status: res.status, detail: res.ok ? "authenticated" : `http_${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Masked posture for dashboards. */
export async function bluevineRestStatus() {
  const rest = await bluevineRest();
  return {
    bound: Boolean(rest.base && rest.key),
    source: rest.source,
    base: rest.base,
    key_last4: rest.key ? rest.key.slice(-4) : null,
  };
}
