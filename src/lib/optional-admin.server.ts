// Best-effort admin detection for endpoints that must serve a redacted
// public payload but a full payload to authenticated admin staff.
export async function isCallerAdmin(): Promise<boolean> {
  try {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const auth = getRequestHeader("authorization") ?? "";
    if (!auth.toLowerCase().startsWith("bearer ")) return false;
    const token = auth.slice(7).trim();
    if (!token) return false;

    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) return false;

    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data: claims, error } = await supabase.auth.getClaims(token);
    const sub = (claims as any)?.claims?.sub;
    if (error || !sub) return false;
    const { data } = await supabase.rpc("has_role" as never, {
      _user_id: sub,
      _role: "admin",
    } as never);
    return Boolean(data);
  } catch {
    return false;
  }
}
