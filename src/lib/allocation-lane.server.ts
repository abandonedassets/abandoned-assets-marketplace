// Deterministic 1031 categorization + parity-based fee lane routing.
//
// Rules (surgical, no network calls, fail-forward):
//   1. asset_category  -> one of the four 1031 like-kind buckets
//   2. valuation >= $100,000  -> SOVEREIGN LOCK: always MAIN_VAULT_TRACK
//   3. valuation <  $100,000  -> last digit of `apn`: even = JASMINE_TRACK,
//                                odd = MAIN_VAULT_TRACK, no digit = MAIN_VAULT_TRACK
//
// Bounded batch + 5-allocations-per-hour velocity cap + runOnce() idempotency.

export const SOVEREIGN_LOCK_USD = 100_000;
export const ALLOCATIONS_PER_HOUR = 5;

export type AssetCategory =
  | "1031_RAW_LAND"
  | "1031_TIMBER_TRACT"
  | "1031_COMMERCIAL"
  | "1031_MODULAR_PLOT";

export type AllocationLane = "MAIN_VAULT_TRACK" | "JASMINE_TRACK";

/** Map a free-text asset type onto one of the four tax-deferred buckets. */
export function classify1031(assetType: string | null | undefined): AssetCategory {
  const t = (assetType ?? "").toLowerCase();
  if (/timber|forest|logging|sawmill|pine|hardwood/.test(t)) return "1031_TIMBER_TRACT";
  if (/modular|mobile|manufactured|trailer|pad/.test(t)) return "1031_MODULAR_PLOT";
  if (/commercial|retail|industrial|office|warehouse|multi|mixed/.test(t)) return "1031_COMMERCIAL";
  return "1031_RAW_LAND";
}

/** Terminal-digit parity split, with the sovereign value overwrite lock. */
export function resolveLane(valuation: number, apn: string | null | undefined): AllocationLane {
  if (Number.isFinite(valuation) && valuation >= SOVEREIGN_LOCK_USD) return "MAIN_VAULT_TRACK";
  const digits = (apn ?? "").replace(/\D/g, "");
  if (!digits) return "MAIN_VAULT_TRACK";
  const last = Number(digits[digits.length - 1]);
  return last % 2 === 0 ? "JASMINE_TRACK" : "MAIN_VAULT_TRACK";
}

export type LaneReport = {
  ok: true;
  scanned: number;
  updated: number;
  jasmine: number;
  vault: number;
  throttled: boolean;
  skipped: number;
};

type Row = {
  id: string;
  apn: string | null;
  asset_type: string | null;
  base_contract_price: number | null;
  assessed_value: number | null;
  target_allocation_lane: string | null;
  asset_category: string | null;
};

/** Bounded, idempotent allocation sweep. Never throws. */
export async function runAllocationLaneSweep(limit = 100): Promise<LaneReport> {
  const report: LaneReport = {
    ok: true,
    scanned: 0,
    updated: 0,
    jasmine: 0,
    vault: 0,
    throttled: false,
    skipped: 0,
  };

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runOnce } = await import("@/lib/command-idempotency.server");
    const { executionKey } = await import("@/lib/command-idempotency.server");

    // Velocity cap — max 5 lane allocations per rolling hour.
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await supabaseAdmin
      .from("processed_commands")
      .select("id", { count: "exact", head: true })
      .eq("command_type", "allocation_lane")
      .gte("created_at", hourAgo);
    const used = Number(count ?? 0);
    if (used >= ALLOCATIONS_PER_HOUR) {
      report.throttled = true;
      return report;
    }
    let budget = ALLOCATIONS_PER_HOUR - used;

    const { data } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id, apn, asset_type, base_contract_price, assessed_value, target_allocation_lane, asset_category")
      .order("created_at", { ascending: false })
      .limit(limit);

    for (const row of ((data ?? []) as unknown as Row[])) {
      if (budget <= 0) {
        report.throttled = true;
        break;
      }
      report.scanned++;

      const valuation = Number(row.base_contract_price ?? row.assessed_value ?? 0);
      const category = classify1031(row.asset_type);
      const lane = resolveLane(valuation, row.apn);

      if (row.target_allocation_lane === lane && row.asset_category === category) {
        report.skipped++;
        continue;
      }

      const key = executionKey(["allocation_lane", row.id, lane, category]);
      const res = await runOnce(
        { key, type: "allocation_lane", source: "allocation-lane-sweep", dealId: row.id },
        async () => {
          await supabaseAdmin
            .from("closing_pipeline_items")
            .update({ target_allocation_lane: lane, asset_category: category } as never)
            .eq("id", row.id);
          return true;
        },
      ).catch(() => null);

      if (res && res.skipped === false) {
        budget--;
        report.updated++;
        if (lane === "JASMINE_TRACK") report.jasmine++;
        else report.vault++;
      } else {
        report.skipped++;
      }
    }
  } catch (e) {
    console.error("[allocation-lane] sweep failed", e);
  }

  return report;
}
