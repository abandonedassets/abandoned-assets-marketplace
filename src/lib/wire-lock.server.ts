// Phase B of two-phase locking: the moment wire instructions are generated the
// deal enters a protected 24-hour banking window that self-heal will not purge.
export async function markWireInFlight(dealId: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.rpc("mark_wire_in_flight" as never, { _deal_id: dealId } as never);
  } catch (e) {
    // Fail-forward: never block wire instruction delivery on telemetry.
    console.error("[wire-lock] mark_wire_in_flight failed", e);
  }
}
