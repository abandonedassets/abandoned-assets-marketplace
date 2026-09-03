// Dutch auction engine: 2.5% assignment-fee decay every 4 hours on unlocked
// REVERSE_STRIKE_READY inventory, re-triggering buyer buy-box algorithms.

export type DecayRow = {
  deal_id: string;
  old_fee: number;
  new_fee: number;
  decay_count: number;
};

export async function runPriceDecay(
  maxRows = 200,
): Promise<{ ok: boolean; decayed: number; rows: DecayRow[]; error?: string }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("decay_stale_assignment_fees" as never, {
      _max_rows: maxRows,
    } as never);
    if (error) return { ok: false, decayed: 0, rows: [], error: error.message };

    const rows = ((data ?? []) as any[]).map((r) => ({
      deal_id: String(r.deal_id),
      old_fee: Number(r.old_fee ?? 0),
      new_fee: Number(r.new_fee ?? 0),
      decay_count: Number(r.decay_count ?? 0),
    }));

    // Real-time price broadcast on the anonymous tape channel.
    for (const r of rows) {
      try {
        await supabaseAdmin.channel("tape:price").send({
          type: "broadcast",
          event: "price_decay",
          payload: r,
        });
      } catch {
        /* fail-forward: telemetry never stalls the decay */
      }
    }
    return { ok: true, decayed: rows.length, rows };
  } catch (e) {
    return { ok: false, decayed: 0, rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}
