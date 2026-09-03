// Pure, deterministic display-only sector tags for the Settlement Terminal tape.
// No backend writes, no routing changes — derived from data already loaded.

import type { LedgerKey } from "@/lib/btr-routing";
import { isCommercial, isLand } from "@/lib/btr-routing";

export type SectorInput = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  county?: string | null;
  zip?: string | null;
  asset_type?: string | null;
  zoning_class?: string | null;
  enrichment_tags?: string[] | null;
  lot_sqft?: number | null;
  sqft?: number | null;
  base_contract_price?: number | null;
};

const MEDICAL_RX = /\b(medical|dental|clinic|surgery|surgical|healthcare|health\s?care|urgent\s?care|life[-\s]?science|lab)\b/i;
const FLEX_RX = /\b(flex|warehouse|industrial|light\s?industrial|distribution|shop|storage)\b/i;
const RETAIL_OFFICE_RX = /\b(retail|office|mall|strip|big[-\s]?box|mixed[-\s]?use)\b/i;
const GRID_RX = /\b(substation|transmission|power|solar|utility|easement|industrial\s?park)\b/i;

function blob(i: SectorInput): string {
  return [i.asset_type, i.zoning_class, i.address, (i.enrichment_tags ?? []).join(" ")]
    .filter(Boolean)
    .join(" ");
}

const ACRE_SQFT = 43_560;

export type SectorBadge = { tag: string; tone: "emerald" | "sky" | "amber" | "violet" | "slate" };

export function sectorBadges(
  i: SectorInput,
  ledger: LedgerKey,
  hasBlock: boolean,
): SectorBadge[] {
  const out: SectorBadge[] = [];
  const t = blob(i);
  const acreage = Number(i.lot_sqft ?? 0) / ACRE_SQFT;
  const land = isLand({
    address: i.address,
    asset_type: i.asset_type,
    zoning_class: i.zoning_class,
    enrichment_tags: i.enrichment_tags,
    acreage,
  });
  const commercial = isCommercial({
    address: i.address,
    asset_type: i.asset_type,
    zoning_class: i.zoning_class,
    enrichment_tags: i.enrichment_tags,
  });

  // 1. Every asset on the terminal is private-portfolio inventory.
  out.push({ tag: "EXCLUSIVE_DIRECT_LISTING", tone: "violet" });

  // 2. Operator contiguous blocks + Jaquita modular inventory.
  if ((ledger === "PRIMARY" && hasBlock) || ledger === "JACQUITA") {
    out.push({ tag: "DEVELOPMENT_READY", tone: "emerald" });
    out.push({ tag: "HIGH_YIELD_POTENTIAL", tone: "emerald" });
  }

  // 3. Digital-infrastructure siting on land / acreage rows.
  if ((land || acreage >= 2) && (acreage >= 2 || GRID_RX.test(t))) {
    out.push({ tag: "POWER_GRID_ADJACENT", tone: "sky" });
  }

  // 4. Niche flex / medical commercial rows.
  if (MEDICAL_RX.test(t)) out.push({ tag: "STICKY_MEDICAL_TENANCY", tone: "amber" });
  if (FLEX_RX.test(t) || (commercial && Number(i.sqft ?? 0) > 0 && Number(i.sqft) < 25_000)) {
    out.push({ tag: "LOW_CAPEX_OVERHEAD", tone: "amber" });
  }

  // 5. Conversion / repositioning potential.
  if (commercial && (RETAIL_OFFICE_RX.test(t) || MEDICAL_RX.test(t) || FLEX_RX.test(t))) {
    out.push({ tag: "ADAPTIVE_REUSE_ELIGIBLE", tone: "sky" });
  }

  const seen = new Set<string>();
  return out.filter((b) => (seen.has(b.tag) ? false : (seen.add(b.tag), true)));
}

export const SECTOR_TONE: Record<SectorBadge["tone"], string> = {
  emerald: "border-emerald-500/50 text-emerald-400",
  sky: "border-sky-500/50 text-sky-400",
  amber: "border-amber-500/50 text-amber-400",
  violet: "border-violet-500/50 text-violet-400",
  slate: "border-border text-muted-foreground",
};
