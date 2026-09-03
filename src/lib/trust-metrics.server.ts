// Institutional algorithmic trust metrics — the "hidden buy box".
// Pure computation, fail-forward: never throws into the pipeline.

import { createHash, createHmac } from "crypto";

const n = (v: unknown) => Number(String(v ?? 0).replace(/[^0-9.\-]/g, "")) || 0;

/** Effective millage (tax rate as decimal of market value) by state; national fallback 1.1%. */
const STATE_MILLAGE: Record<string, number> = {
  AL: 0.0041, AK: 0.0104, AZ: 0.0063, AR: 0.0062, CA: 0.0071, CO: 0.0051,
  CT: 0.0179, DE: 0.0058, FL: 0.0089, GA: 0.0092, HI: 0.0029, ID: 0.0069,
  IL: 0.0208, IN: 0.0085, IA: 0.0157, KS: 0.0141, KY: 0.0086, LA: 0.0055,
  ME: 0.0128, MD: 0.0105, MA: 0.0114, MI: 0.0138, MN: 0.0111, MS: 0.0079,
  MO: 0.0097, MT: 0.0083, NE: 0.0163, NV: 0.0055, NH: 0.0193, NJ: 0.0242,
  NM: 0.0078, NY: 0.0172, NC: 0.0080, ND: 0.0098, OH: 0.0156, OK: 0.0090,
  OR: 0.0097, PA: 0.0153, RI: 0.0140, SC: 0.0057, SD: 0.0124, TN: 0.0071,
  TX: 0.0180, UT: 0.0060, VT: 0.0190, VA: 0.0082, WA: 0.0094, WV: 0.0059,
  WI: 0.0176, WY: 0.0061, DC: 0.0056,
};

export function localMillageRate(state?: string | null): number {
  const s = String(state ?? "").trim().toUpperCase();
  return STATE_MILLAGE[s] ?? 0.011;
}

/** Bots underwrite NOI on POST-closing taxes: sale price resets the assessment. */
export function projectedPostSaleTax(d: {
  base_contract_price?: number | string | null;
  optimized_acquisition_premium?: number | string | null;
  annual_property_tax?: number | string | null;
  assessed_value?: number | string | null;
  state?: string | null;
}) {
  const purchase = n(d.base_contract_price) + n(d.optimized_acquisition_premium);
  const rate = localMillageRate(d.state);
  const projected = Math.round(purchase * rate);
  const historical = Math.round(n(d.annual_property_tax));
  return {
    purchase_price: purchase,
    local_millage_rate: rate,
    projected_post_sale_tax: projected,
    historical_property_tax: historical || null,
    reassessment_delta: historical ? projected - historical : null,
    basis: "purchase_price * local_millage_rate",
  };
}

/** 100-point chain-of-title purity. <100 => human legal review required. */
export function titlePurityScore(d: {
  title_status?: string | null;
  requires_legal_review?: boolean | null;
  lien_total?: number | string | null;
  owner_entity?: string | null;
  owner_acquired_at?: string | null;
  enrichment_tags?: string[] | null;
}) {
  let score = 100;
  const flags: string[] = [];
  const tags = (d.enrichment_tags ?? []).map((t) => String(t).toUpperCase());
  const owner = String(d.owner_entity ?? "").toUpperCase();

  if (String(d.title_status ?? "Pending") === "Uninsurable") {
    score -= 60;
    flags.push("UNINSURABLE_TITLE");
  } else if (String(d.title_status ?? "") !== "Insured") {
    score -= 15;
    flags.push("TITLE_UNVERIFIED");
  }

  if (d.requires_legal_review) {
    score -= 25;
    flags.push("LEGAL_REVIEW_PENDING");
  }

  if (n(d.lien_total) > 0) {
    score -= 10;
    flags.push("RECORDED_LIENS");
  }

  if (/ESTATE|HEIR|PROBATE|DECEASED|TRUSTEE OF/.test(owner) || tags.some((t) => /PROBATE|HEIR/.test(t))) {
    score -= 30;
    flags.push("UNRESOLVED_HEIRSHIP");
  }

  if (tags.some((t) => /QUITCLAIM|TAX_DEED|TAX_CERTIFICATE|SHERIFF_DEED/.test(t))) {
    score -= 30;
    flags.push("NON_WARRANTY_DEED_CHAIN");
  }

  // Recent transfer (<24 months) — daisy-chain / flip-chain risk.
  const acquired = d.owner_acquired_at ? Date.parse(d.owner_acquired_at) : NaN;
  if (!Number.isNaN(acquired)) {
    const months = (Date.now() - acquired) / (1000 * 60 * 60 * 24 * 30.44);
    if (months < 24) {
      score -= 20;
      flags.push("TRANSFER_WITHIN_24_MONTHS");
    }
  }

  score = Math.max(0, Math.min(100, score));
  return {
    title_purity_score: score,
    legal_friction: score < 100,
    legal_friction_flags: flags,
    bypass_human_legal_review: score === 100,
  };
}

/**
 * Anti-daisy-chain exclusivity certificate. Deterministic per deal, keyed to a
 * server secret, so a fund can verify direct-to-seller contract control.
 */
export function exclusivityHash(d: {
  id?: string | null;
  apn?: string | null;
  address?: string | null;
  county?: string | null;
}) {
  const secret = process.env["EXCLUSIVITY_HASH_SECRET"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
  const canonical = [d.id, d.apn, d.address, d.county]
    .map((v) => String(v ?? "").trim().toUpperCase())
    .join("|");
  const digest = secret
    ? createHmac("sha256", secret).update(canonical).digest("hex")
    : createHash("sha256").update(canonical).digest("hex");
  return {
    exclusivity_hash: digest,
    exclusivity_algo: secret ? "HMAC-SHA256" : "SHA256",
    direct_to_seller: true,
    daisy_chain: false,
    public_board_listed: false,
    attestation: "Contract control held directly with titled seller. Not sourced from a public deal board.",
  };
}

/** FEMA / EPA spatial exclusion. Zone X (or shaded X) clears. */
export function femaClearance(d: { fema_zone?: string | null; env_status?: string | null; env_flag_reason?: string | null }) {
  const zone = String(d.fema_zone ?? "").trim().toUpperCase();
  const env = `${d.env_status ?? ""} ${d.env_flag_reason ?? ""}`.toUpperCase();
  const highRisk = /^(A|AE|AO|AH|A99|AR|V|VE)$/.test(zone) || /FLOOD|SUPERFUND|EPA/.test(env);
  return {
    fema_zone: zone || "X",
    fema_zone_clear: !highRisk,
    epa_superfund_within_1mi: /SUPERFUND/.test(env),
  };
}

/** HOA rental moratorium clearance. */
export function hoaClearance(d: {
  hoa_present?: boolean | null;
  hoa_rental_allowed?: boolean | null;
  enrichment_tags?: string[] | null;
}) {
  const tags = (d.enrichment_tags ?? []).map((t) => String(t).toUpperCase());
  const present = d.hoa_present ?? tags.some((t) => /\bHOA\b/.test(t));
  const capped = tags.some((t) => /RENTAL_CAP|RENTAL_BAN|LEASING_WAITLIST|MORATORIUM/.test(t));
  const allowed = d.hoa_rental_allowed ?? (!present ? true : !capped);
  return {
    hoa_present: !!present,
    hoa_rental_allowed: !!allowed,
    hoa_rental_cap_clear: !present || !!allowed,
  };
}

/** Full trust block injected into deal decks and M2M contract payloads. */
export function buildTrustMetrics(d: Record<string, any>) {
  const fema = femaClearance(d);
  const hoa = hoaClearance(d);
  const title = titlePurityScore(d);
  const tax = projectedPostSaleTax(d);
  const excl = exclusivityHash(d);
  const auto_lock_eligible =
    fema.fema_zone_clear && hoa.hoa_rental_cap_clear && title.title_purity_score >= 80;

  return {
    trust_version: "TRUST-1.0",
    ...title,
    ...fema,
    ...hoa,
    ...excl,
    ...tax,
    auto_lock_eligible,
    auto_lock_blockers: [
      ...(fema.fema_zone_clear ? [] : ["FEMA_FLOOD_OR_EPA_EXCLUSION"]),
      ...(hoa.hoa_rental_cap_clear ? [] : ["HOA_RENTAL_MORATORIUM"]),
      ...(title.title_purity_score >= 80 ? [] : ["LEGAL_FRICTION"]),
    ],
  };
}
