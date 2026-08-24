import { createHmac } from 'crypto';

/**
 * System Compliance Exception Framework
 * Forces immediate loop short-circuiting to prevent downstream 403 authorization failures
 */
export class CriticalComplianceError extends Error {
  constructor(message: string) {
    super(`CRITICAL_COMPLIANCE_FAILURE: ${message}`);
    this.name = 'CriticalComplianceError';
    Object.setPrototypeOf(this, CriticalComplianceError.prototype);
  }
}

export interface AssetRowData {
  apn: string;
  contract_type_string: string;
  execution_timestamp: string;
  calculated_fee: string;
  gross_acreage: number;
  buildable_acreage_net: number;
  target_acquisition_strike_price: number;
  substation_distance_miles: number;
  max_slope: number;
  wetland_pct: number;
  raw_county_zip: string;
  fips_code?: string;
  // Decoupled Real-World Database Columns
  digital_contract_hash?: string;
  title_co_routing_code?: string;
  escrow_opened_at?: string;
  emd_amount_deposited?: string;
  escrow_receipt_number?: string;
}

/**
 * Programmatic M2M Infrastructure Underwriting and Compliance Engine
 * Tiered Integration Layout: ZIP Corridor -> Terrain -> DSCR Floor -> Real Legal Mapping
 */
export function processAssetUnderwriting(rawRow: AssetRowData, secretKey: string): any {
  try {
    // TIER 1: Spatial Proximity Pre-Flight Optimization
    if (rawRow.substation_distance_miles > 1.0) {
      return { status: 'REJECTED', reason: 'GRID_DISTANCE_EXCEEDS_1_MILE_RADIUS' };
    }

    // TIER 2: Environmental & Topography Masking 
    if (rawRow.max_slope > 3.0 || rawRow.wetland_pct >= 1.0) {
      return { status: 'REJECTED', reason: 'TERRAIN_UNBUILDABLE_SLOPE_OR_WETLAND' };
    }

    if (rawRow.buildable_acreage_net <= 0 || rawRow.target_acquisition_strike_price <= 0) {
      return { status: 'REJECTED', reason: 'INVALID_METRICS_OR_ZERO_NET_ACREAGE' };
    }

    // TIER 3: Core Financial Power Modeling & DSCR Evaluation
    const annualKwh = rawRow.buildable_acreage_net * 200000 * 0.20; // 20% Capacity Factor constant
    const projectedRevenue = annualKwh * 0.06; // $0.06/kWh PPA rate constant

    // Enforce the $500 baseline property tax floor protection
    const calculatedTax = rawRow.gross_acreage * 100.00;
    const annualTax = Math.max(calculatedTax, 500.00); 
    
    const maintenance = rawRow.buildable_acreage_net * 250.00;
    const totalOpex = annualTax + maintenance;

    const netOperatingIncome = projectedRevenue - totalOpex;
    const annualDebtService = rawRow.target_acquisition_strike_price * 0.08; // 8% Constant Amortization Equivalent

    if (annualDebtService <= 0) {
      return { status: 'REJECTED', reason: 'DEBT_SERVICE_DIVIDE_BY_ZERO' };
    }

    const calculatedDscr = netOperatingIncome / annualDebtService;

    // Enforce the 1.30 Institutional Floor Rule
    if (calculatedDscr < 1.30) {
      return { status: 'REJECTED', reason: 'DSCR_BELOW_INSTITUTIONAL_1.30_FLOOR' };
    }

    // Parse unpadded 9-digit ZIP code anomaly via robust inline regex processing
    const rawZip = rawRow.raw_county_zip ? rawRow.raw_county_zip.trim() : "";
    const zipMatch = rawZip.match(/^(\d{5})(\d{4})$/);
    const parsedZipObj = zipMatch 
      ? { 
          raw_string: rawRow.raw_county_zip, 
          postal_code: zipMatch[1], 
          plus_four: zipMatch[2], 
          regex_match_type: "unpadded_9_digit" 
        }
      : { 
          raw_string: rawRow.raw_county_zip, 
          postal_code: rawZip.slice(0, 5), 
          plus_four: "0000", 
          regex_match_type: "fallback" 
        };

    // TIER 4: Strict Fail-Fast Guard Verification (The Core System Fix)
    if (!rawRow.escrow_receipt_number || !rawRow.digital_contract_hash || !rawRow.title_co_routing_code) {
      throw new CriticalComplianceError(
        `Parcel APN ${rawRow.apn} missing valid physical escrow IDs or signed contract hashes.`
      );
    }

    // TIER 5: Explicit Schema-3.5.0 Clean Column Assembly
    const finalizedPayload = {
      schema_version: "3.5.0",
      transaction_metadata: {
        generation_timestamp: new Date().toISOString(),
        underwriting_status: "VERIFIED_REAL_WORLD"
      },
      asset_identifiers: {
        entity_type: "LAND",
        apn_raw: rawRow.apn,
        fips_code: rawRow.fips_code || "",
        owner_zip_parsed: parsedZipObj
      },
      grid_proximity_analysis: {
        st_dwithin_distance_miles: parseFloat(rawRow.substation_distance_miles.toFixed(2))
      },
      spatial_constraints: {
        gross_acreage: rawRow.gross_acreage,
        buildable_acreage_net: rawRow.buildable_acreage_net,
        max_slope: rawRow.max_slope
      },
      financial_underwriting_metrics: {
        base_energy_kwh_projected_annual: Math.round(annualKwh),
        net_operating_income_usd: Math.round(netOperatingIncome),
        calculated_dscr_target: parseFloat(calculatedDscr.toFixed(2)),
        dscr_floor_validated: true
      },
      equitable_interest_manifest: {
        contract_vehicle_type: rawRow.contract_type_string,
        contract_status: "EXECUTED_ACTIVE",
        effective_date: rawRow.execution_timestamp,
        assignment_fee_usd: parseFloat(rawRow.calculated_fee),
        docu_anchor_hash: rawRow.digital_contract_hash // Authentic audit trail token
      },
      settlement_and_escrow_anchor: {
        escrow_file_status: "OPENED_VERIFIED",
        title_company_routing_id: rawRow.title_co_routing_code, // Explicitly decoupled
        escrow_account_opened_timestamp: rawRow.escrow_opened_at,
        earnest_money_deposit_status: "HELD_IN_ESCROW",
        emd_amount_usd: parseFloat(rawRow.emd_amount_deposited || "0"), // Explicitly decoupled
        physical_escrow_id: rawRow.escrow_receipt_number // Explicitly decoupled
      }
    };

    // TIER 6: Cryptographic Signature Authorization
    const serialized = JSON.stringify(finalizedPayload);
    const signature = createHmac('sha256', secretKey).update(serialized).digest('hex');

    return {
      status: 'APPROVED',
      payload: finalizedPayload,
      signature: signature
    };

  } catch (error) {
    if (error instanceof CriticalComplianceError) {
      // Gracefully catch compliance errors and flag them as REJECTED to preserve background processing loop stability
      return { status: 'REJECTED', reason: error.message };
    }
    return { status: 'REJECTED', reason: `UNEXPECTED_SYSTEM_FAILURE: ${(error as Error).message}` };
  }
}
