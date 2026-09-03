// 15-minute FBO eviction clock — matched to M2M_WINDOW_SECONDS (900s) so the
// two clocks can never race and prematurely thrash a live lock.
//
// Stamp: the moment an asset flips to WIRE_INSTRUCTIONS_SENT and a virtual bank
// track is minted, allocation_expires_at = now + 15 minutes.
// Sweep: any lapsed row burns its FBO token, drops the buyer match and is
// re-exposed to the open tape as REVERSE_STRIKE_READY.

export const EVICTION_WINDOW_MS = 15 * 60_000;

/** Stamp the eviction deadline. Fail-forward: never throws. */
export async function stampAllocationExpiry(dealId: string, ms = EVICTION_WINDOW_MS) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({ allocation_expires_at: new Date(Date.now() + ms).toISOString() } as never)
      .eq("id", dealId);
    return true;
  } catch (e) {
    console.error("[eviction] stamp failed", dealId, e);
    return false;
  }
}

export type EvictionReport = { ok: boolean; evicted: number; error?: string };

/** Bounded eviction sweep of every lapsed allocation. Never throws. */
export async function runEvictionSweep(limit = 200): Promise<EvictionReport> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nowIso = new Date().toISOString();

    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id, matched_buyer_id, matched_buy_box_id")
      .not("allocation_expires_at", "is", null)
      .lt("allocation_expires_at", nowIso)
      .is("cleared_at", null)
      .limit(limit);

    const rows = (data ?? []) as Array<{ id: string }>;
    let evicted = 0;

    for (const row of rows) {
      try {
        await supabaseAdmin
          .from("closing_pipeline_items")
          .update({
            allocation_expires_at: null,
            matched_buyer_id: null,
            matched_buy_box_id: null,
            wire_instructions_status: null,
            wire_instructions_target: null,
            reverse_strike_ready: true,
            updated_at: nowIso,
          } as never)
          .eq("id", row.id);

        // Burn the temporary FBO allocation parameters.
        await supabaseAdmin
          .from("inbound_wire_accounts")
          .update({ status: "EVICTED" } as never)
          .eq("pipeline_item_id", row.id);

        const { appendLedger } = await import("@/lib/event-ledger.server");
        await appendLedger({
          entity: "closing_pipeline_items",
          entityId: row.id,
          operation: "ALLOCATION_EVICTED",
          actor: "eviction_sweep",
          after: { reason: "30m_wire_window_lapsed", state: "REVERSE_STRIKE_READY" },
        }).catch(() => null);

        evicted++;
      } catch (e) {
        console.error("[eviction] row failed", row.id, e);
      }
    }

    return { ok: true, evicted };
  } catch (e) {
    return { ok: false, evicted: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
