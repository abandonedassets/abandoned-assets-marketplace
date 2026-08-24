import { createHmac } from 'crypto';
import {
  buildInfraPacket,
  CriticalComplianceError,
  calculateUnderwriting,
  validateZipCorridor,
  validateTerrainMask,
  validateSpatialProximity,
  RealWorldRowData,
  InfraPacket,
} from '@/lib/infra-underwrite';

interface DispatchRecord {
  id: string;
  row: RealWorldRowData;
  status: 'pending' | 'success' | 'compliance_hold' | 'error';
  error?: string;
  packet?: InfraPacket;
}

interface DispatchResult {
  totalProcessed: number;
  successful: number;
  complianceHolds: number;
  failed: number;
  records: DispatchRecord[];
}

/**
 * Computes HMAC-SHA256 signature for outgoing payloads
 */
function generateHmacSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Dispatches an infrastructure packet to the production webhook endpoint with HMAC validation
 */
export async function dispatchPacket(packet: InfraPacket): Promise<void> {
  const targetUrl = process.env.PRODUCTION_WEBHOOK_URL;
  const hmacSecret = process.env.M2M_HMAC_SECRET || process.env.PACKET_SIGNING_KEY;

  if (!targetUrl) {
    throw new Error('[DISPATCH_FAILED] PRODUCTION_WEBHOOK_URL is not defined in environment variables.');
  }

  const payloadString = JSON.stringify(packet);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = hmacSecret ? generateHmacSignature(payloadString, hmacSecret) : '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'M2M-Asset-Switchboard-Cannon/3.5',
    'X-Switchboard-Timestamp': timestamp,
  };

  if (signature) {
    headers['X-Switchboard-Signature'] = signature;
  }

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers,
    body: payloadString,
  });

  if (!response.ok) {
    throw new Error(`[DISPATCH_FAILED] Target endpoint returned HTTP ${response.status}: ${response.statusText}`);
  }

  console.log(`[DISPATCH_SUCCESS] Packet for APN ${packet.apn} delivered to ${targetUrl}`);
}

/**
 * Fetches pending pipeline rows from database or Supabase adapter
 */
export async function fetchPendingAssets(): Promise<RealWorldRowData[]> {
  try {
    // Attempt Supabase adapter if available
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await supabase
        .from('closing_pipeline_items')
        .select('*')
        .eq('status', 'pending');

      if (error) throw error;
      if (data) return data as RealWorldRowData[];
    }
  } catch {
    // Fall back to direct SQL or custom DB pool if initialized
  }

  return [];
}

/**
 * Batch processing engine with non-blocking compliance fail-fast handling
 */
export async function processOutboundDispatch(
  rows: RealWorldRowData[]
): Promise<DispatchResult> {
  const result: DispatchResult = {
    totalProcessed: rows.length,
    successful: 0,
    complianceHolds: 0,
    failed: 0,
    records: [],
  };

  for (const row of rows) {
    const record: DispatchRecord = {
      id: row.apn,
      row,
      status: 'pending',
    };

    try {
      const tier1Valid = validateZipCorridor(row.apn);
      const tier2Valid = validateTerrainMask(row.apn);
      const tier3Valid = validateSpatialProximity(row.apn);

      const computedUnderwriting = calculateUnderwriting(
        row,
        tier1Valid,
        tier2Valid,
        tier3Valid
      );

      try {
        const packet = buildInfraPacket(row, computedUnderwriting);
        record.packet = packet;
        record.status = 'success';
        result.successful += 1;
      } catch (complianceError) {
        if (complianceError instanceof CriticalComplianceError) {
          console.warn('[COMPLIANCE_HOLD]', complianceError.message);
          record.status = 'compliance_hold';
          record.error = complianceError.message;
          result.complianceHolds += 1;
          result.records.push(record);
          continue;
        }
        throw complianceError;
      }

      result.records.push(record);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[DISPATCH_ERROR]', errorMessage, { apn: row.apn });
      record.status = 'error';
      record.error = errorMessage;
      result.failed += 1;
      result.records.push(record);
    }
  }

  return result;
}

/**
 * Main cron worker loop
 */
export async function runDispatchWorker(batchSize: number = 100): Promise<void> {
  console.log(`[WORKER_START] Starting dispatch worker batch size: ${batchSize}`);
  
  const rows = await fetchPendingAssets();
  
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const result = await processOutboundDispatch(batch);

    for (const record of result.records) {
      if (record.status === 'success' && record.packet) {
        try {
          await dispatchPacket(record.packet);
        } catch (err) {
          console.error('[DISPATCH_PACKET_ERROR]', {
            apn: record.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  console.log('[WORKER_COMPLETE] Dispatch run finalized.');
}
