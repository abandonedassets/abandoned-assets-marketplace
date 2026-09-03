// Bifurcated Cloud Matrix — dual-core routing.
//   Track A (High-Frequency Residential): volume, tight 15s TTL micro-auctions,
//     routed to cash buyers / flippers / residential funds.
//   Track B (Institutional Commercial): margin, WALE/NOI underwriting, routed to
//     1031 panic capital, REITs, syndicates.
// Pure fail-forward: a failing row never blocks the sweep.
import { classifyAllocation } from "@/lib/allocation-matrix";

type Row = Record<string, any>;

export type Track = "TRACK_A_RESIDENTIAL" | "TRACK_B_COMMERCIAL";

const COMMERCIAL_BUCKETS = new Set([
  "INDUSTRIAL_LAST_MILE",
  "MULTI_TENANT_RETAIL",
  "MULTI_FAMILY_3PLUS",
  "SPECIALIZED_INFRA",
]);

/** Deterministic track assignment from zoning + asset type + unit count. */
export function assignTrack(row: Row): {
  track: Track;
  bucket: string;
  channel: string;
  ttl_seconds: number;
  target_spread_pct: number;
} {
  const a = classifyAllocation({
    asset_type: row["asset_type"],
    zoning_category: row["zoning_category"],
    zoning_class: row["zoning_class"],
    enrichment_tags: row["enrichment_tags"],
    buyer_channel: row["buyer_channel"],
    address: row["address"],
    beds: row["beds"],
    sqft: row["sqft"],
  });
  const commercial = COMMERCIAL_BUCKETS.has(a.bucket);
  return commercial
    ? {
        track: "TRACK_B_COMMERCIAL",
        bucket: a.bucket,
        channel: "INSTITUTIONAL_1031",
        ttl_seconds: 900,
        target_spread_pct: 0.17,
      }
    : {
        track: "TRACK_A_RESIDENTIAL",
        bucket: a.bucket,
        channel: "RESIDENTIAL_CASH",
        ttl_seconds: 15,
        target_spread_pct: 0.1,
      };
}

/** WALE (years) + NOI from any rent-roll payload we already carry. */
export function parseCommercialMetrics(row: Row) {
  const roll = Array.isArray(row["rent_roll"]) ? (row["rent_roll"] as Row[]) : [];
  if (!roll.length) return { noi_usd: null as number | null, wale_years: null as number | null };
  const now = Date.now();
  let rentTotal = 0;
  let weighted = 0;
  for (const l of roll) {
    const rent = Number(l["annual_rent"] ?? l["rent"] ?? 0) || 0;
    const end = Date.parse(String(l["lease_end"] ?? l["expiry"] ?? ""));
    rentTotal += rent;
    if (Number.isFinite(end)) {
      weighted += rent * Math.max(0, (end - now) / (365.25 * 864e5));
    }
  }
  const opex = Number(row["annual_opex"]) || rentTotal * 0.35;
  return {
    noi_usd: Number((rentTotal - opex).toFixed(2)),
    wale_years: rentTotal > 0 ? Number((weighted / rentTotal).toFixed(2)) : null,
  };
}

/** Stamp track routing on live inventory. Idempotent. */
export async function runBifurcationSweep(limit = 200) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id,status,asset_type,asset_class,zoning_category,zoning_class,enrichment_tags,buyer_channel,address,beds,sqft,base_contract_price",
      )
      .is("cleared_at", null)
      .not("status", "in", '("Dead","Rejected","Auto_Archived_Bad_Data","Closed")')
      .limit(limit);
    if (error) throw error;

    const rows = (data ?? []) as Row[];
    let a = 0;
    let b = 0;
    let updated = 0;

    for (const r of rows) {
      try {
        const t = assignTrack(r);
        if (t.track === "TRACK_B_COMMERCIAL") b++;
        else a++;

        const tags: string[] = Array.isArray(r["enrichment_tags"]) ? [...r["enrichment_tags"]] : [];
        const next = new Set(tags.filter((x) => !String(x).startsWith("TRACK_")));
        next.add(t.track);
        next.add(`BUCKET:${t.bucket}`);
        if (
          r["buyer_channel"] === t.channel &&
          tags.length === next.size &&
          tags.every((x) => next.has(x))
        ) {
          continue;
        }
        const { error: upErr } = await supabaseAdmin
          .from("closing_pipeline_items")
          .update({ buyer_channel: t.channel, enrichment_tags: [...next] } as never)
          .eq("id", r["id"]);
        if (!upErr) updated++;
      } catch {
        /* fail-forward: never stall the lane */
      }
    }

    return { ok: true, scanned: rows.length, track_a: a, track_b: b, updated };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * 1031 "Panic Capital" ledger: buyers inside the IRS 45-day identification
 * window get pre-underwritten commercial tape pushed at day >= 35, when their
 * capital is forced to deploy and the spread commands 15-20%.
 */
export async function run1031PanicRouting(limit = 50) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: boxes } = await supabaseAdmin
      .from("buyer_buy_boxes")
      .select("id,buyer_id,persona,window_expiration,exchange_deadline_at,active")
      .eq("active", true)
      .eq("persona", "EXCHANGE_1031" as never)
      .limit(limit);


    const now = Date.now();
    const panic = ((boxes ?? []) as Row[]).filter((b) => {
      const exp = Date.parse(String(b["window_expiration"] ?? b["exchange_deadline_at"] ?? ""));
      if (!Number.isFinite(exp)) return false;
      const daysLeft = (exp - now) / 864e5;
      return daysLeft <= 10 && daysLeft > 0; // day >= 35 of 45
    });

    if (!panic.length) return { ok: true, panic_buyers: 0, dispatched: 0 };

    const { data: tape } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id,buyer_channel,base_contract_price,zip,asset_type")
      .eq("buyer_channel", "INSTITUTIONAL_1031")
      .is("cleared_at", null)
      .order("base_contract_price", { ascending: false })
      .limit(25);

    const assets = (tape ?? []) as Row[];
    if (!assets.length) return { ok: true, panic_buyers: panic.length, dispatched: 0 };

    let dispatched = 0;
    for (const buyer of panic) {
      try {
        const { error } = await supabaseAdmin.from("outbound_alert_log").insert({
          channel: "PANIC_1031_TAPE",
          target: String(buyer["buyer_id"] ?? ""),
          status: "queued",
          payload: {
            spread_target_pct: 0.17,
            buy_box_id: buyer["id"],
            asset_ids: assets.map((x) => x["id"]),
            deadline: buyer["window_expiration"] ?? buyer["exchange_deadline_at"],
          } as never,
        } as never);

        if (!error) dispatched++;
      } catch {
        /* fail-forward */
      }
    }
    return { ok: true, panic_buyers: panic.length, dispatched };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
