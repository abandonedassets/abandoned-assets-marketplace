// M2M infrastructure packet builder (schema 3.5.0).
//
// Truth rule: legal/escrow blocks are emitted from REAL row data only. When a
// contract, counterparty, or escrow file is absent, the packet ships those
// fields as PENDING/false. No synthetic clearance is ever fabricated — the
// settlement gate in settlement-binding.ts remains the single source of truth.

import { createHmac } from "crypto";
import { processAssetUnderwriting, type IngestionPayload } from "./infra-underwrite";
import { settlementBinding, type GateFields } from "./settlement-binding";

export const M2M_SCHEMA_VERSION = "3.5.0";

export type LegalAnchor = GateFields & {
  contract_vehicle_type?: string | null;
  contract_effective_date?: string | null;
  assignment_fee_usd?: number | null;
  exclusivity_period_days?: number | null;
  legal_vesting_entity?: string | null;
  emd_amount_usd?: number | null;
  emd_status?: string | null;
  escrow_opened_at?: string | null;
};

export type PacketResult =
  | { status: "REJECTED"; reason: string }
  | { status: "APPROVED"; payload: Record<string, unknown>; signature: string; settlement_ready: boolean };

export function buildInfraPacket(
  asset: IngestionPayload & Record<string, unknown>,
  legal: LegalAnchor = {},
  secretKey = process.env["M2M_HMAC_SECRET"] ?? process.env["PACKET_SIGNING_KEY"] ?? "",
): PacketResult {
  const uw = processAssetUnderwriting(asset);
  if (uw.status === "REJECTED") return { status: "REJECTED", reason: uw.reason };

  const binding = settlementBinding(legal);

  const payload = {
    transaction_id: `m2m_infra_${asset.apn_raw ?? "unknown"}_${Date.now()}`,
    timestamp: new Date().toISOString(),
    schema_version: M2M_SCHEMA_VERSION,
    data_integrity: {
      ingest_worker: "autonomous-gis-ingest",
      system_origin_signature_type: "HMAC-SHA256",
    },
    asset_identifiers: {
      entity_type: "LAND",
      apn_raw: asset.apn_raw,
      fips_code: asset.fips_code ?? null,
      owner_zip_parsed: uw.zip,
    },
    grid_proximity_analysis: {
      st_dwithin_distance_miles: Number(asset.substation_distance_miles),
    },
    spatial_constraints: {
      gross_acreage: Number(asset.gross_acreage) || 0,
      buildable_acreage_net: Number(asset.buildable_acreage_net) || 0,
      usgs_dem_slope_gradient_max: Number(asset.max_slope ?? 0),
      nwi_wetland_overlay_pct: Number(asset.wetland_pct ?? 0),
    },
    financial_underwriting_metrics: {
      ...uw.metrics,
      target_acquisition_strike_price: Number(asset.target_acquisition_strike_price),
      dscr_floor_validated: true,
    },
    equitable_interest_manifest: {
      contract_vehicle_type: legal.contract_vehicle_type ?? "ASSIGNABLE_PURCHASE_AGREEMENT",
      contract_status: legal.signed_contract_hash ? "EXECUTED_ACTIVE" : "PENDING_EXECUTION",
      effective_date: legal.contract_effective_date ?? null,
      assignment_fee_usd: legal.assignment_fee_usd ?? null,
      exclusivity_period_days: legal.exclusivity_period_days ?? null,
      legal_vesting_entity: legal.legal_vesting_entity ?? null,
      docu_anchor_hash: legal.signed_contract_hash ?? null,
    },
    settlement_and_escrow_anchor: {
      escrow_file_status: legal.title_escrow_file_number ? "OPENED_VERIFIED" : "NOT_OPENED",
      title_company_routing_id: legal.title_escrow_file_number ?? null,
      escrow_account_opened_timestamp: legal.escrow_opened_at ?? null,
      earnest_money_deposit_status: legal.emd_status ?? "NOT_POSTED",
      emd_amount_usd: legal.emd_amount_usd ?? null,
      predictive_title_cleared: false,
    },
    routing_target_buybox: {
      capital_tier: "alternative_credit_infrastructure",
      wire_routing_status: binding.bound ? "READY_TO_TRIGGER" : "AWAITING_REAL_WORLD_DATA",
    },
    settlement_binding: binding,
  };

  const signature = createHmac("sha256", secretKey || "dev-unsigned")
    .update(JSON.stringify(payload))
    .digest("hex");

  return { status: "APPROVED", payload, signature, settlement_ready: binding.bound };
}
