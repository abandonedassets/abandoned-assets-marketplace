// COMMERCIAL inbound intake. Machine-generated commercial / CRE payloads
// arrive by email and were previously ignored by the intent parser (it only
// understood CONTRACT_REQUEST language), so their fees never hit the owner's
// balance. Fail-forward: never throws into the webhook.

import { parseDealPayload } from "@/lib/deal-payload";
import { BENEFICIARY_LABELS } from "@/lib/beneficiary-routing";

const COMMERCIAL_RX =
  /\b(commercial|cre|retail\s*(pad|center|strip)?|office(\s*(building|park|suite))?|industrial|warehouse|flex\s*space|multi-?family|mixed[-\s]?use|nnn|triple\s*net|cap\s*rate|noi|storefront|business\s*park|substation|data\s*cent(er|re))\b/i;

/** Any commercial keyword anywhere in the subject, body, or structured payload. */
export function isCommercialPayload(text: string, payload?: unknown): boolean {
  if (COMMERCIAL_RX.test(text)) return true;
  try {
    return COMMERCIAL_RX.test(JSON.stringify(payload ?? {}));
  } catch {
    return false;
  }
}

const MONEY_RX =
  /(?:spread|assignment[_\s-]?fee|fee|net[_\s-]?proceeds|proceeds|premium|amount)[^0-9$-]{0,20}\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;

/**
 * Extracts the underlying fee. Structured payload first (spread_usd /
 * assignment_fee, incl. DOUBLE_CLOSE), then free-text money capture.
 */
export function extractCommercialFee(text: string, payload?: unknown): number {
  const structured = parseDealPayload(payload);
  if (structured.fee > 0) return structured.fee;

  let best = 0;
  for (const m of text.matchAll(MONEY_RX)) {
    const n = Number(String(m[1]).replace(/,/g, ""));
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best;
}

function findUuid(text: string): string | null {
  const m = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

export type CommercialIntakeResult = {
  commercial: boolean;
  fee_usd: number;
  pipeline_item_id: string | null;
  allocated: boolean;
  reason: string;
};

/**
 * Commercial mandate: 100% of the extracted fee is credited to the owner's
 * PRIMARY clearing account on the internal sub-ledger, on autopilot. Missing
 * metadata never stalls the credit.
 */
export async function processCommercialIntake(input: {
  text: string;
  payload?: unknown;
  fromEmail?: string | null;
  matchedItemId?: string | null;
}): Promise<CommercialIntakeResult> {
  const text = input.text ?? "";
  if (!isCommercialPayload(text, input.payload)) {
    return {
      commercial: false,
      fee_usd: 0,
      pipeline_item_id: null,
      allocated: false,
      reason: "not_commercial",
    };
  }

  const fee = extractCommercialFee(text, input.payload);
  let itemId = input.matchedItemId ?? findUuid(text);

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!itemId) {
      const ref = text.match(/\b(?:APN|Asset Reference|Ref)[:\s#]+([A-Za-z0-9._-]{4,40})/i)?.[1];
      if (ref) {
        const { data } = await supabaseAdmin
          .from("closing_pipeline_items")
          .select("id")
          .or(`external_id.eq.${ref},apn.eq.${ref}`)
          .limit(1);
        itemId = data?.[0]?.id ?? null;
      }
    }

    if (fee <= 0) {
      return {
        commercial: true,
        fee_usd: 0,
        pipeline_item_id: itemId,
        allocated: false,
        reason: "no_fee_parameter_found",
      };
    }

    const marker = `commercial_intake:${itemId ?? (input.fromEmail ?? "unmatched")}:${fee}`;
    const { data: existing } = await supabaseAdmin
      .from("internal_beneficiary_allocations" as never)
      .select("id")
      .eq("external_transfer_id", marker)
      .limit(1);
    if (existing && existing.length) {
      return {
        commercial: true,
        fee_usd: fee,
        pipeline_item_id: itemId,
        allocated: false,
        reason: "already_credited",
      };
    }

    const { error } = await supabaseAdmin
      .from("internal_beneficiary_allocations" as never)
      .insert({
        pipeline_item_id: itemId,
        beneficiary_key: "PRIMARY",
        beneficiary_label: BENEFICIARY_LABELS.PRIMARY,
        amount_usd: fee,
        pct: 1,
        reason: "Commercial mandate — 100% owner (inbound commercial payload)",
        status: "accrued",
        external_transfer_id: marker,
      } as never);
    if (error) {
      return {
        commercial: true,
        fee_usd: fee,
        pipeline_item_id: itemId,
        allocated: false,
        reason: `ledger_write_failed:${error.message}`,
      };
    }

    return {
      commercial: true,
      fee_usd: fee,
      pipeline_item_id: itemId,
      allocated: true,
      reason: "credited_owner_100pct",
    };
  } catch (e) {
    return {
      commercial: true,
      fee_usd: fee,
      pipeline_item_id: itemId,
      allocated: false,
      reason: `error:${String((e as Error).message).slice(0, 160)}`,
    };
  }
}
