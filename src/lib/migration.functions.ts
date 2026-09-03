import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type TableReport = {
  table: string;
  discovered: number;
  ingested: number;
  skipped: number;
  failed: number;
  status: "ok" | "empty" | "unreachable" | "no-properties" | "error";
  error?: string;
};

// Heuristic column pickers
const ADDR_KEYS = ["address", "street", "street_address", "property_address", "addr", "address1", "line1"];
const ZIP_KEYS = ["zip", "zipcode", "zip_code", "postal_code", "postal"];
const CITY_KEYS = ["city", "town", "municipality"];
const STATE_KEYS = ["state", "region", "province"];
const COUNTY_KEYS = ["county"];
const PRICE_KEYS = ["base_contract_price", "price", "purchase_price", "contract_price", "acquisition_price", "list_price", "asking_price", "price_usd"];
const ARV_KEYS = ["underwritten_arv", "arv", "after_repair_value", "estimated_arv"];
const FEE_KEYS = ["optimized_acquisition_premium", "assignment_fee", "wholesale_fee", "fee", "spread"];
const BEDS_KEYS = ["beds", "bedrooms", "num_beds"];
const BATHS_KEYS = ["baths", "bathrooms", "num_baths"];
const SQFT_KEYS = ["sqft", "square_feet", "living_area", "sqft_total"];
const YEAR_KEYS = ["year_built", "yearbuilt", "built_year"];
const STATUS_KEYS = ["status", "deal_status", "pipeline_status", "stage"];

const DEFAULT_TABLES = [
  "properties", "property", "leads", "deals", "deal", "contracts",
  "assignments", "seller_leads", "buyer_leads", "inventory",
  "closing_pipeline_items", "pipeline_items", "listings",
];

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] != null && row[k] !== "") return row[k];
    const lk = k.toLowerCase();
    for (const rk of Object.keys(row)) {
      if (rk.toLowerCase() === lk && row[rk] != null && row[rk] !== "") return row[rk];
    }
  }
  return null;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function extractZip(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

const STATUS_MAP: Record<string, string> = {
  new: "New", lead: "New", active: "New", prospect: "New",
  review: "Under-Review", underwriting: "Under-Review", "under-review": "Under-Review",
  "seller-signed": "Seller-Signed", "seller signed": "Seller-Signed", signed: "Seller-Signed", assigned: "Seller-Signed",
  "buyer-signed": "Buyer-Signed", "buyer signed": "Buyer-Signed", "under contract": "Buyer-Signed",
  escrow: "In-Escrow", "in-escrow": "In-Escrow", "in escrow": "In-Escrow",
  "locked-escrow-pending": "Locked-Escrow-Pending", locked: "Locked-Escrow-Pending",
  "funds-cleared": "Funds-Cleared", funded: "Funds-Cleared", paid: "Funds-Cleared",
  closed: "Closed", complete: "Closed", completed: "Closed",
  dead: "Dead", cancelled: "Dead", canceled: "Dead", lost: "Dead",
  stall: "CRITICAL_STALL", stalled: "CRITICAL_STALL",
};

function mapStatus(v: unknown): string {
  const s = toStr(v);
  if (!s) return "New";
  const k = s.toLowerCase().trim();
  return STATUS_MAP[k] ?? "New";
}

function mapRow(row: Record<string, unknown>, table: string): Record<string, unknown> | null {
  const address = toStr(pick(row, ADDR_KEYS));
  let zip = toStr(pick(row, ZIP_KEYS));
  if (!zip) zip = extractZip(address);
  const price = toNum(pick(row, PRICE_KEYS));
  if (!zip || !price || price <= 0) return null;

  const arv = toNum(pick(row, ARV_KEYS));
  let fee = toNum(pick(row, FEE_KEYS));
  if (fee == null && arv != null && arv > price) fee = Math.max(0, arv - price);

  const legacyId = toStr(pick(row, ["id", "uuid", "external_id"]));
  return {
    external_id: legacyId ? `legacy:${table}:${legacyId}` : null,
    zip,
    address,
    city: toStr(pick(row, CITY_KEYS)),
    state: toStr(pick(row, STATE_KEYS)),
    county: toStr(pick(row, COUNTY_KEYS)),
    beds: toNum(pick(row, BEDS_KEYS)),
    baths: toNum(pick(row, BATHS_KEYS)),
    sqft: toNum(pick(row, SQFT_KEYS)),
    year_built: toNum(pick(row, YEAR_KEYS)),
    base_contract_price: price,
    optimized_acquisition_premium: fee ?? 0,
    status: mapStatus(pick(row, STATUS_KEYS)),
    source: `legacy:${table}`,
  };
}

async function fetchPage(baseUrl: string, anon: string, table: string, from: number, to: number) {
  const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=*`;
  const res = await fetch(url, {
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      Range: `${from}-${to}`,
      "Range-Unit": "items",
      Prefer: "count=exact",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`http_${res.status}: ${text.slice(0, 200)}`);
  }
  const rows = (await res.json()) as Record<string, unknown>[];
  const contentRange = res.headers.get("content-range") || "";
  const total = parseInt(contentRange.split("/")[1] || "0", 10) || rows.length;
  return { rows, total };
}

export const executeTotalSystemSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { legacyUrl: string; legacyAnonKey: string; tables?: string[] }) => d)
  .handler(async ({ data, context }) => {
    // Authorize admin
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin only");

    const baseUrl = data.legacyUrl.replace(/\/+$/, "");
    const anon = data.legacyAnonKey.trim();
    if (!/^https:\/\//.test(baseUrl)) throw new Error("legacyUrl must be https://");
    if (anon.length < 20) throw new Error("legacyAnonKey looks invalid");

    const tables = (data.tables && data.tables.length ? data.tables : DEFAULT_TABLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const reports: TableReport[] = [];
    const PAGE = 1000;

    for (const table of tables) {
      const rep: TableReport = { table, discovered: 0, ingested: 0, skipped: 0, failed: 0, status: "ok" };
      try {
        // probe first page
        let first;
        try {
          first = await fetchPage(baseUrl, anon, table, 0, PAGE - 1);
        } catch (e: any) {
          const msg = String(e?.message || e);
          if (msg.includes("http_404") || msg.includes("PGRST205") || msg.includes("relation")) {
            rep.status = "unreachable";
            rep.error = "table not found or not exposed";
            reports.push(rep);
            continue;
          }
          throw e;
        }
        rep.discovered = first.total;
        if (first.total === 0) {
          rep.status = "empty";
          reports.push(rep);
          continue;
        }

        // Process pages
        let offset = 0;
        let rows = first.rows;
        let hadAnyMappable = false;
        while (rows.length > 0) {
          const mapped: Record<string, unknown>[] = [];
          for (const r of rows) {
            const m = mapRow(r, table);
            if (m) mapped.push(m);
            else rep.skipped++;
          }
          if (mapped.length > 0) {
            hadAnyMappable = true;
            // split rows with external_id (upsert) vs without (insert, ignore conflict on zip+address)
            const withExt = mapped.filter((r) => r.external_id);
            const without = mapped.filter((r) => !r.external_id);
            if (withExt.length) {
              const { error, count } = await supabaseAdmin
                .from("closing_pipeline_items")
                .upsert(withExt as any, { onConflict: "external_id", ignoreDuplicates: false, count: "exact" });
              if (error) { rep.failed += withExt.length; rep.error = error.message; }
              else rep.ingested += count ?? withExt.length;
            }
            if (without.length) {
              const { error, count } = await supabaseAdmin
                .from("closing_pipeline_items")
                .insert(without as any, { count: "exact" });
              if (error) { rep.failed += without.length; rep.error = error.message; }
              else rep.ingested += count ?? without.length;
            }
          }
          offset += rows.length;
          if (offset >= first.total) break;
          const next = await fetchPage(baseUrl, anon, table, offset, offset + PAGE - 1);
          rows = next.rows;
        }
        if (!hadAnyMappable) rep.status = "no-properties";
      } catch (e: any) {
        rep.status = "error";
        rep.error = String(e?.message || e).slice(0, 300);
      }
      reports.push(rep);
    }

    const totals = reports.reduce(
      (a, r) => ({
        discovered: a.discovered + r.discovered,
        ingested: a.ingested + r.ingested,
        skipped: a.skipped + r.skipped,
        failed: a.failed + r.failed,
      }),
      { discovered: 0, ingested: 0, skipped: 0, failed: 0 },
    );

    return { reports, totals, completedAt: new Date().toISOString() };
  });
