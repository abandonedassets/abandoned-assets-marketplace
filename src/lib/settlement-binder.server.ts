// M2M Cryptographic Settlement Binder.
// Three-pillar machine-readable proof payload: legal control (contract hash),
// algorithmic diligence (clean structured asset data + FIX tags), and the
// escrow clearing route (settlement webhook + idempotency key).
// Fail-forward: never throws into a caller; returns typed error objects.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Api-Key",
};

export const BINDER_CORS = CORS;

const SETTLEMENT_HOOK = "https://abandonedasset.online/api/public/hooks/stripe-settlement";

const VERIFIED_TIERS = ["CRYPTOGRAPHICALLY_VERIFIED", "VERIFIED"];

export function binderUrl(dealId: string) {
  return `https://abandonedasset.online/api/private/m2m/settlement-binder/${dealId}`;
}

function bearerOf(request: Request): string {
  const raw = request.headers.get("authorization") ?? "";
  if (raw.toLowerCase().startsWith("bearer ")) return raw.slice(7).trim();
  return (request.headers.get("x-api-key") ?? "").trim();
}

/** Only cryptographically verified / verified live nodes may pull a binder. */
export async function authorizeBinderCaller(request: Request) {
  const key = bearerOf(request);
  if (!key) return { ok: false as const, status: 401, error: "unauthorized" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: box } = await supabaseAdmin
    .from("buyer_buy_boxes")
    .select("id, label, active, endpoint_status, verification_tier, m2m_api_key")
    .eq("m2m_api_key", key)
    .maybeSingle();

  if (!box || !(box as any).active)
    return { ok: false as const, status: 401, error: "unauthorized" };

  const status = String((box as any).endpoint_status ?? "").toUpperCase();
  const tier = String((box as any).verification_tier ?? "").toUpperCase();
  if (!VERIFIED_TIERS.includes(status) && !VERIFIED_TIERS.includes(tier))
    return { ok: false as const, status: 403, error: "endpoint_not_verified", detail: status || tier || null };

  return { ok: true as const, box: box as any };
}

export async function buildSettlementBinder(dealId: string, buyerId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(dealId))
    return { ok: false as const, status: 400, error: "invalid_deal_id" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: d, error } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id, address, city, state, zip, apn, asset_type, asset_class, cre_class, title_status, signed_contract_hash, verified_counterparty_id, title_escrow_file_number, contract_structure, base_contract_price, optimized_acquisition_premium, calculated_arv, estimated_cap_rate, noi_usd, locked_at, updated_at, cleared_at",
    )
    .eq("id", dealId)
    .maybeSingle();

  if (error) return { ok: false as const, status: 500, error: "lookup_failed", detail: error.message };
  if (!d) return { ok: false as const, status: 404, error: "deal_not_found" };

  const row = d as any;
  const { createHash, randomUUID } = await import("crypto");
  const binderId = randomUUID();

  const titleCleared = /clean|insured|clear/i.test(String(row.title_status ?? ""));
  const contractHash = row.signed_contract_hash
    ? String(row.signed_contract_hash)
    : createHash("sha256")
        .update(`${row.id}|${row.apn ?? ""}|${row.base_contract_price ?? 0}|UNEXECUTED`)
        .digest("hex");

  const legalControl = Boolean(row.signed_contract_hash);
  const dealStatus =
    row.cleared_at
      ? "CLEARED"
      : legalControl && titleCleared
        ? "LOCKED_READY_FOR_CLEARING"
        : "PENDING_LEGAL_CONTROL";

  const price = Number(row.base_contract_price ?? 0);
  const fee = Number(row.optimized_acquisition_premium ?? 0);

  return {
    ok: true as const,
    binder: {
      binder_id: binderId,
      deal_id: row.id,
      deal_status: dealStatus,

      pillar_1_legal_control: {
        direct_to_seller: true,
        contract_executed: legalControl,
        contract_execution_hash: contractHash,
        execution_timestamp: row.locked_at ?? row.updated_at ?? null,
        escrow_file_number: row.title_escrow_file_number ?? null,
      },

      pillar_2_asset_diligence: {
        clear_title_verified: titleCleared,
        title_status: row.title_status ?? null,
        fix_metrics: {
          Tag44_CurrentPrice: price,
          Tag167_AssetClass: String(row.cre_class ?? row.asset_class ?? row.asset_type ?? "REALESTATE"),
          Tag231_ContractMultiplier: Number(row.estimated_cap_rate ?? 0),
          Tag15_Currency: "USD",
        },
        arv_usd: Number(row.calculated_arv ?? 0),
        noi_usd: Number(row.noi_usd ?? 0),
        assignment_fee_usd: fee,
        unlocked_address: [row.address, row.city, row.state, row.zip].filter(Boolean).join(", ") || null,
        unlocked_apn: row.apn ?? null,
      },

      pillar_3_clearing_routing: {
        escrow_node: "BLUEVINE_WIRE_DIRECT",
        settlement_webhook: SETTLEMENT_HOOK,
        settlement_routing_id: `STRIPE_SETTLEMENT:BV-${String(row.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`,
        required_idempotency_key: createHash("sha256").update(`${binderId}${buyerId}`).digest("hex"),
        total_due_usd: price + fee,
      },
    },
  };
}
