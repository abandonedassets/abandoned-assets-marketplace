import { processAssetUnderwriting, AssetRowData } from '../src/lib/infra-underwrite';

describe('processAssetUnderwriting - Compliance & Signature Validation', () => {
  const secretKey = 'test_m2m_hmac_secret_key';

  const baseAsset: AssetRowData = {
    apn: 'APN-987-654',
    contract_type_string: 'ASSIGNMENT',
    execution_timestamp: '2026-08-24T12:00:00Z',
    calculated_fee: '12500',
    gross_acreage: 15,
    buildable_acreage_net: 12,
    target_acquisition_strike_price: 150000,
    substation_distance_miles: 0.4,
    max_slope: 1.2,
    wetland_pct: 0.0,
    raw_county_zip: '410111234',
    digital_contract_hash: '0x8f2d4e5a6b7c8d9e',
    title_co_routing_code: 'TR-99823',
    escrow_opened_at: '2026-08-24T10:00:00Z',
    emd_amount_deposited: '5000',
    escrow_receipt_number: 'ESC-44109'
  };

  test('approves compliant asset with schema 3.5.0 and HMAC sha256 signature', () => {
    const result = processAssetUnderwriting(baseAsset, secretKey);

    expect(result.status).toBe('APPROVED');
    expect(result.payload.schema_version).toBe('3.5.0');
    expect(result.payload.settlement_and_escrow_anchor.physical_escrow_id).toBe('ESC-44109');
    expect(result.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  test('catches missing escrow ID and short-circuits to REJECTED', () => {
    const missingEscrow = { ...baseAsset, escrow_receipt_number: undefined } as unknown as AssetRowData;
    const result = processAssetUnderwriting(missingEscrow, secretKey);

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toContain('CRITICAL_COMPLIANCE_FAILURE');
  });

  test('rejects low DSCR (< 1.30 floor)', () => {
    const highPrice = { ...baseAsset, target_acquisition_strike_price: 5000000 };
    const result = processAssetUnderwriting(highPrice, secretKey);

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('DSCR_BELOW_INSTITUTIONAL_1.30_FLOOR');
  });
});
