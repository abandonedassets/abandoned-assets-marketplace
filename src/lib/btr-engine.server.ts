// Autonomous ledger routing + contiguous BTR block assembly.
// Operates on the real dataset only. Fail-forward: a bad row never stops a sweep.
import {
  classifyBtr,
  mergeTags,
  ledgerOf,
  streetKey,
  houseNumber,
  type LedgerKey,
} from "@/lib/btr-routing";

type Row = Record<string, any>;

/** Core-asset quarantine: the roar commercial pack is never touched. */
export function isQuarantined(row: Row): boolean {
  const blob = [
    row["source"],
    row["asset_class"],
    row["address"],
    row["title_notes"],
    (row["enrichment_tags"] ?? []).join(" "),
  ]
    .filter(Boolean)
    .join(" ");
  return /\broar\b/i.test(blob);
}

export function classifyRow(row: Row) {
  return classifyBtr({
    id: row["id"],
    valuation:
      Number(row["base_contract_price"] ?? 0) ||
      Number(row["assessed_value"] ?? 0) ||
      0,
    parcel_number: row["parcel_number"] ?? row["apn"],
    apn: row["apn"],
    city: row["city"],
    county: row["county"],
    state: row["state"],
    address: row["address"],
    asset_class: row["asset_class"],
    asset_type: row["asset_type"],
    zoning_category: row["zoning_category"],
    zoning_class: row["zoning_class"],
    acreage: row["acreage"],
    enrichment_tags: row["enrichment_tags"],
  });
}

const SELECT =
  "id,address,city,county,state,zip,apn,parcel_number,asset_class,asset_type,zoning_category,zoning_class,acreage,base_contract_price,assessed_value,enrichment_tags,adjacent_parcel_count,source,title_notes,status,payout_status,optimized_acquisition_premium,updated_at,cre_class,fee_bps,noi_usd,estimated_cap_rate,expense_ratio,walt_years,tenant_credit_tier,debt_distress_flag,debt_maturity_date,env_status,cre_lane";


/** Re-route + re-tag the live dataset against the institutional rules. */
export async function backfillLedgerRouting(limit = 5000) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(SELECT)
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Row[];
  const counts: Record<LedgerKey, number> = { PRIMARY: 0, JACQUITA: 0, DAUGHTER: 0 };
  let updated = 0;
  let quarantined = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      if (isQuarantined(row)) {
        quarantined++;
        continue;
      }
      const c = classifyRow(row);
      counts[c.ledger]++;
      const tags = mergeTags(row["enrichment_tags"], c.tags);
      const before = (row["enrichment_tags"] ?? []).slice().sort().join("|");
      if (before === tags.slice().sort().join("|")) continue;
      const { error: upErr } = await supabaseAdmin
        .from("closing_pipeline_items")
        .update({ enrichment_tags: tags } as never)
        .eq("id", row["id"]);
      if (upErr) failed++;
      else updated++;
    } catch {
      failed++;
    }
  }

  return { scanned: rows.length, updated, quarantined, failed, counts };
}

export type BtrBlock = {
  block_id: string;
  zip: string | null;
  street: string;
  deal_ids: string[];
  parcel_count: number;
  combined_basis: number;
  combined_acreage: number;
};

/** Spatial grouping of Operator even/odd parcels into contiguous BTR blocks. */
export async function assembleBtrBlocks(opts: { commit?: boolean } = {}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(SELECT)
    .limit(5000);
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as Row[]).filter(
    (r) => !isQuarantined(r) && ledgerOf(r["enrichment_tags"]) === "PRIMARY",
  );

  // Bucket by zip + normalized street, then chain house numbers within 6.
  const buckets = new Map<string, Row[]>();
  for (const r of rows) {
    const key = streetKey(r["address"], r["zip"]);
    const n = houseNumber(r["address"]);
    if (!key || n == null) continue;
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }

  const blocks: BtrBlock[] = [];
  for (const [key, arr] of buckets) {
    arr.sort((a, b) => (houseNumber(a["address"]) ?? 0) - (houseNumber(b["address"]) ?? 0));
    let run: Row[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const ids = run.map((r) => String(r["id"]));
        blocks.push({
          block_id: `BTR-${key.split("|")[0] || "00000"}-${(houseNumber(run[0]!["address"]) ?? 0)}-${run.length}`,
          zip: run[0]!["zip"] ?? null,
          street: key.split("|")[1] ?? "",
          deal_ids: ids,
          parcel_count: ids.length,
          combined_basis: run.reduce((s, r) => s + (Number(r["base_contract_price"]) || 0), 0),
          combined_acreage: run.reduce((s, r) => s + (Number(r["acreage"]) || 0), 0),
        });
      }
      run = [];
    };
    for (const r of arr) {
      if (run.length === 0) {
        run = [r];
        continue;
      }
      const prev = houseNumber(run[run.length - 1]!["address"]) ?? 0;
      const cur = houseNumber(r["address"]) ?? 0;
      if (cur - prev <= 6) run.push(r);
      else flush(), (run = [r]);
    }
    flush();
  }

  let tagged = 0;
  if (opts.commit) {
    for (const b of blocks) {
      for (const id of b.deal_ids) {
        try {
          const row = rows.find((r) => String(r["id"]) === id);
          const tags = mergeTags(row?.["enrichment_tags"], [
            "LEDGER_PRIMARY",
            "CONTIGUOUS_COMMERCIAL_BTR_BLOCK",
            "BTR_COMPLIANT",
            "COMMERCIAL_ZONED_MULTIFAMILY",
            `BTR_BLOCK:${b.block_id}`,
          ]);
          const { error: upErr } = await supabaseAdmin
            .from("closing_pipeline_items")
            .update({
              enrichment_tags: tags,
              adjacent_parcel_count: b.parcel_count,
            } as never)
            .eq("id", id);
          if (!upErr) tagged++;
        } catch {
          /* fail-forward */
        }
      }
    }
  }

  return {
    blocks: blocks.sort((a, b) => b.parcel_count - a.parcel_count).slice(0, 200),
    block_count: blocks.length,
    parcels_in_blocks: blocks.reduce((s, b) => s + b.parcel_count, 0),
    tagged,
  };
}

/** Unified tape: every asset class with its internal ledger + live state. */
export async function readLedgerTape(limit = 300) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(SELECT)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Row[];
  const totals: Record<string, { count: number; basis: number }> = {};
  const tape = rows.map((r) => {
    const ledger = ledgerOf(r["enrichment_tags"]);
    const basis = Number(r["base_contract_price"]) || 0;
    totals[ledger] = {
      count: (totals[ledger]?.count ?? 0) + 1,
      basis: (totals[ledger]?.basis ?? 0) + basis,
    };
    const tags: string[] = r["enrichment_tags"] ?? [];
    return {
      id: String(r["id"]),
      address: (r["address"] as string) ?? null,
      city: (r["city"] as string) ?? null,
      state: (r["state"] as string) ?? null,
      zip: (r["zip"] as string) ?? null,
      asset_type: (r["asset_type"] as string) ?? null,
      asset_class: (r["asset_class"] as string) ?? null,
      cre_class: (r["cre_class"] as string) ?? null,
      fee_bps: r["fee_bps"] == null ? null : Number(r["fee_bps"]),
      noi_usd: r["noi_usd"] == null ? null : Number(r["noi_usd"]),
      cap_rate: r["estimated_cap_rate"] == null ? null : Number(r["estimated_cap_rate"]),
      expense_ratio: r["expense_ratio"] == null ? null : Number(r["expense_ratio"]),
      walt_years: r["walt_years"] == null ? null : Number(r["walt_years"]),
      tenant_credit_tier: (r["tenant_credit_tier"] as string) ?? null,
      debt_distress_flag: Boolean(r["debt_distress_flag"]),
      debt_maturity_date: (r["debt_maturity_date"] as string) ?? null,
      env_status: (r["env_status"] as string) ?? null,
      cre_lane: (r["cre_lane"] as string) ?? null,
      basis,
      ledger,

      status: (r["status"] as string) ?? null,
      payout_status: (r["payout_status"] as string) ?? null,
      updated_at: (r["updated_at"] as string) ?? null,
      block_id: tags.find((t) => t.startsWith("BTR_BLOCK:"))?.slice(10) ?? null,
      flags: tags.filter(
        (t) =>
          t === "BTR_COMPLIANT" ||
          t === "COMMERCIAL_ZONED_MULTIFAMILY" ||
          t === "COMMERCIAL_GRADE_BTR_READY" ||
          t === "ESG_CARBON_CREDIT_ELIGIBLE" ||
          t === "CONTIGUOUS_COMMERCIAL_BTR_BLOCK",
      ),
    };
  });

  return { generated_at: new Date().toISOString(), totals, tape };
}
