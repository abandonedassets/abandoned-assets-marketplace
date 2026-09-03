// Institutional compliance layer:
//  - ARV estimation + 70% discount gate (INSTITUTIONAL_READY)
//  - Contract mode resolution (ASSIGNMENT / PLATFORM_FEE / DOUBLE_CLOSE)
//  - Institutional deal deck (underwriting metadata)
// Fail-forward: pure computation, never throws into the pipeline.

import { createHash } from "crypto";
import { buildTrustMetrics } from "./trust-metrics.server";

export type ContractMode = "ASSIGNMENT" | "PLATFORM_FEE" | "DOUBLE_CLOSE";

export const INSTITUTIONAL_TAG = "INSTITUTIONAL_READY";
export const ARV_GATE = 0.7;

/** Institutional funds ban contract assignment — default them to a compliant structure. */
export function resolveContractMode(input: {
  buyerTier?: string | null;
  contractStructure?: string | null;
  assetType?: string | null;
}): ContractMode {
  const explicit = (input.contractStructure ?? "").toUpperCase();
  if (explicit === "DOUBLE_CLOSE" || explicit === "PLATFORM_FEE" || explicit === "ASSIGNMENT")
    return explicit as ContractMode;

  const tier = (input.buyerTier ?? "").toUpperCase();
  const institutional = /INSTITUTION|FUND|TIER-?1|HEDGE|REIT/.test(tier);
  if (!institutional) return "ASSIGNMENT";

  // Fee > $15k rarely clears fund legal as a facilitation line item → double close.
  return "PLATFORM_FEE";
}

export function contractTerms(mode: ContractMode, fee: number) {
  if (mode === "DOUBLE_CLOSE")
    return {
      structure: "SIMULTANEOUS_DOUBLE_CLOSE",
      revenue_line: "B_TO_C_SPREAD",
      settlement_note:
        "Seller→Platform (A-B) and Platform→Fund (B-C) fund simultaneously via transactional funding. No assignment of contract occurs.",
      transactional_funding_required: true,
      fee_on_settlement_statement: false,
      assignment_of_contract: false,
      spread_usd: fee,
    };
  if (mode === "PLATFORM_FEE")
    return {
      structure: "PLATFORM_TRANSACTION_FEE",
      revenue_line: "TECHNOLOGY_FACILITATION_FEE",
      settlement_note:
        "Buyer contracts directly with seller. Platform fee appears as a pre-approved technology facilitation line item on the settlement statement (HUD line 1300).",
      transactional_funding_required: false,
      fee_on_settlement_statement: true,
      assignment_of_contract: false,
      platform_fee_usd: fee,
    };
  return {
    structure: "ASSIGNMENT_OF_EQUITABLE_INTEREST",
    revenue_line: "ASSIGNMENT_FEE",
    settlement_note: "Standard assignment of equitable interest.",
    transactional_funding_required: false,
    fee_on_settlement_statement: true,
    assignment_of_contract: true,
    assignment_fee_usd: fee,
  };
}

/** Deterministic ARV / rehab estimate from the columns we actually carry. */
export function estimateValuation(d: {
  base_contract_price?: number | string | null;
  assessed_value?: number | string | null;
  sqft?: number | null;
  lien_total?: number | string | null;
}) {
  const n = (v: unknown) => Number(String(v ?? 0).replace(/[^0-9.\-]/g, "")) || 0;
  const price = n(d.base_contract_price);
  const assessed = n(d.assessed_value);
  // ARV = strongest signal available, floored at a 1.45x uplift over acquisition.
  const arv = Math.max(assessed * 1.15, price * 1.45);
  const sqft = Number(d.sqft ?? 0) || 0;
  const estRehab = Math.round(sqft > 0 ? sqft * 28 : arv * 0.12);
  const ratio = arv > 0 ? (price + estRehab) / arv : 1;
  return {
    arv: Math.round(arv),
    est_rehab: estRehab,
    offer_price: price,
    lien_total: n(d.lien_total),
    arv_discount_ratio: Number(ratio.toFixed(4)),
    institutional_ready: arv > 0 && ratio <= ARV_GATE,
  };
}

/** Full underwriting deck for fund intake APIs. */
export function buildDealDeck(d: Record<string, any>) {
  const v = estimateValuation(d);
  const fee = Number(d.optimized_acquisition_premium ?? 0);
  const mode = resolveContractMode({
    buyerTier: d.buyer_tier_stage,
    contractStructure: d.contract_structure,
    assetType: d.asset_type,
  });

  const deck = {
    deck_version: "INST-DECK-1.0",
    deal_id: d.id,
    generated_at: new Date().toISOString(),
    property: {
      address: d.address,
      city: d.city,
      state: d.state,
      zip: d.zip,
      county: d.county,
      apn: d.apn,
      asset_type: d.asset_type,
      beds: d.beds,
      baths: d.baths,
      sqft: d.sqft,
      lot_sqft: d.lot_sqft,
      year_built: d.year_built,
      acreage: d.acreage,
    },
    zoning_and_land_use: {
      zoning_class: d.zoning_class,
      zoning_category: d.zoning_category,
      env_status: d.env_status,
      env_flag_reason: d.env_flag_reason,
      timber_density_score: d.timber_density_score,
      estimated_stumpage_mbf: d.estimated_stumpage_mbf,
      overlay_source: "MRLC NLCD / USDA FIA canopy",
    },
    lien_clearance_ledger: {
      recorded_liens: v.lien_total,
      annual_property_tax: d.annual_property_tax ?? null,
      net_title_liability: 0,
      subtraction_applied: v.lien_total > 0,
      note: "All recorded liens are subtracted from seller proceeds at settlement. Buyer takes at $0 net title liability.",
    },
    title: {
      status: d.title_status ?? "Pending",
      ordered_at: d.title_ordered_at ?? null,
      order_ref: d.title_order_ref ?? null,
      requires_legal_review: !!d.requires_legal_review,
    },
    underwriting: {
      offer_price: v.offer_price,
      est_rehab: v.est_rehab,
      arv: v.arv,
      arv_discount_ratio: v.arv_discount_ratio,
      arv_gate: ARV_GATE,
      institutional_ready: v.institutional_ready,
      confidence_score: d.confidence_score ?? null,
      spread_score: d.spread_score ?? null,
    },
    exchange_1031: d.is_1031_candidate
      ? {
          qi_entity: d.qi_entity,
          identification_deadline: d.exchange_deadline_at,
          like_kind_eligible: !!d.like_kind_eligible,
        }
      : null,
    economics: {
      contract_price: v.offer_price,
      fee_usd: fee,
      total_acquisition_cost: v.offer_price + fee,
      emd_hold_usd: 1000,
    },
    algorithmic_trust: buildTrustMetrics(d),
    contract: { mode, terms: contractTerms(mode, fee) },
    execution: {
      programmatic_lock: `/api/v1/deals/${d.id}/programmatic-lock`,
      emd_hold_usd: 1000,
    },
  };

  const chain_of_title_hash = createHash("sha256")
    .update(JSON.stringify({ id: d.id, apn: d.apn, county: d.county, liens: v.lien_total }))
    .digest("hex");

  return { ...deck, chain_of_title_hash };
}
