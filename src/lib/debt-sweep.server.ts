// Synthetic Tri-Party Clearing Router.
// Intercepts cleared/settled assignment yield, services SBLOC debt FIRST
// (routed straight to the lender endpoint), then sweeps net yield to treasury.
// Journaled once per deal in system_audit_log (table_name = 'triparty_sweep').

type Row = Record<string, any>;

export type SblocFacility = {
  lender_name: string;
  drawn_balance_usd: number;
  apr_pct: number;
  lender_endpoint: string | null;
};

const DEFAULT_FACILITY: SblocFacility = {
  lender_name: "Unassigned Lender Network",
  drawn_balance_usd: 0,
  apr_pct: 0,
  lender_endpoint: null,
};

export async function getFacility(): Promise<SblocFacility> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("system_config")
      .select("value")
      .eq("key", "sbloc_facility")
      .maybeSingle();
    const v = (data as Row | null)?.["value"] ?? {};
    return {
      lender_name: String(v.lender_name ?? DEFAULT_FACILITY.lender_name),
      drawn_balance_usd: Number(v.drawn_balance_usd ?? 0) || 0,
      apr_pct: Number(v.apr_pct ?? 0) || 0,
      lender_endpoint: typeof v.lender_endpoint === "string" ? v.lender_endpoint : null,
    };
  } catch {
    return DEFAULT_FACILITY;
  }
}

/** Daily accrued interest on the drawn balance (actual/365). */
export function dailyAccruedInterest(f: SblocFacility): number {
  const i = (f.drawn_balance_usd * (f.apr_pct / 100)) / 365;
  return Number.isFinite(i) && i > 0 ? Number(i.toFixed(2)) : 0;
}

export type SweepRow = {
  deal_id: string;
  gross_fee_usd: number;
  debt_service_usd: number;
  net_retained_usd: number;
  lender_ack: string;
  swept_at: string;
};

export async function runAtomicDebtSweep(limit = 100) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const facility = await getFacility();
    const dailyInterest = dailyAccruedInterest(facility);

    const { data, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id,status,optimized_acquisition_premium,cleared_at")
      .not("cleared_at", "is", null)
      .order("cleared_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const rows = ((data ?? []) as Row[]).filter(
      (r) => Number(r["optimized_acquisition_premium"]) > 0,
    );
    if (!rows.length)
      return { ok: true, swept: 0, debt_service_usd: 0, net_retained_usd: 0, rows: [] as SweepRow[] };

    const { data: seen } = await supabaseAdmin
      .from("system_audit_log")
      .select("row_id")
      .eq("table_name", "triparty_sweep")
      .in("row_id", rows.map((r) => r["id"]) as never);
    const have = new Set(((seen ?? []) as Row[]).map((r) => r["row_id"]));

    const out: SweepRow[] = [];
    let debtTotal = 0;
    let netTotal = 0;

    for (const r of rows) {
      if (have.has(r["id"])) continue;
      const gross = Number(r["optimized_acquisition_premium"]) || 0;
      // Debt service is capped by the gross fee — never route more than arrived.
      const debt = Number(Math.min(dailyInterest, gross).toFixed(2));
      const net = Number((gross - debt).toFixed(2));

      let ack = debt > 0 ? "NO_ENDPOINT" : "NO_DEBT";
      if (debt > 0 && facility.lender_endpoint) {
        try {
          const res = await fetch(facility.lender_endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "sbloc_debt_service",
              deal_id: r["id"],
              amount_usd: debt,
              drawn_balance_usd: facility.drawn_balance_usd,
              apr_pct: facility.apr_pct,
              sent_at: new Date().toISOString(),
            }),
            signal: AbortSignal.timeout(15_000),
          });
          ack = res.ok ? `ACK_${res.status}` : `NACK_${res.status}`;
        } catch (e) {
          ack = `NACK_${(e as Error).message.slice(0, 40)}`;
        }
      }

      const swept_at = new Date().toISOString();
      try {
        const { error: insErr } = await supabaseAdmin.from("system_audit_log").insert({
          table_name: "triparty_sweep",
          operation: "SWEEP",
          row_id: r["id"],
          new_data: {
            gross_fee_usd: gross,
            debt_service_usd: debt,
            net_retained_usd: net,
            lender_name: facility.lender_name,
            lender_ack: ack,
            swept_at,
          } as never,
        } as never);
        if (!insErr) {
          debtTotal += debt;
          netTotal += net;
          out.push({
            deal_id: String(r["id"]),
            gross_fee_usd: gross,
            debt_service_usd: debt,
            net_retained_usd: net,
            lender_ack: ack,
            swept_at,
          });
        }
      } catch {
        /* fail-forward */
      }
    }

    return {
      ok: true,
      swept: out.length,
      debt_service_usd: Number(debtTotal.toFixed(2)),
      net_retained_usd: Number(netTotal.toFixed(2)),
      rows: out,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message, swept: 0, rows: [] as SweepRow[] };
  }
}

export async function listSweepLedger(limit = 50) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("system_audit_log")
    .select("row_id,new_data,created_at")
    .eq("table_name", "triparty_sweep")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((r) => ({
    deal_id: String(r["row_id"] ?? ""),
    created_at: String(r["created_at"] ?? ""),
    gross_fee_usd: Number(r["new_data"]?.gross_fee_usd ?? 0),
    debt_service_usd: Number(r["new_data"]?.debt_service_usd ?? 0),
    net_retained_usd: Number(r["new_data"]?.net_retained_usd ?? 0),
    lender_ack: String(r["new_data"]?.lender_ack ?? "—"),
  }));
}
