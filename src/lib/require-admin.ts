// Zero-trust gate: privileged RPCs are only reachable after an explicit
// admin role check performed with the caller's own (RLS-bound) client.
export async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
  return true;
}
