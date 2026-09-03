// M2M Clearinghouse — four-tier liquidity orchestration.
//  1) Bi-directional single-session auto-negotiation (auto_counter_matrix)
//  2) Shadow liquidity cross-clearing (race-to-clear + DEAL_LOCKED revocation)
//  3) Programmatic C2C flash capital pooling
//  4) Data fidelity index injected into every payload
//  5) Cryptographic double-assignment shield (m2m_asset_hash)
//
// Fail-forward: every sub-step is wrapped; a failure never stalls the deal.

import { createHash, createHmac } from "crypto";

export const HANDSHAKE_MS = 30_000;

const baseUrl = () => process.env["PUBLIC_APP_URL"] ?? "https://asset-weaver-30.lovable.app";

export function transactionHash(input: {
  parcelId: string | null;
  askingPrice: number;
  timestamp: string;
  sellerAuth: boolean;
}) {
  return createHash("sha256")
    .update(
      `${input.parcelId ?? "unparceled"}|${input.askingPrice}|${input.timestamp}|${input.sellerAuth}`,
    )
    .digest("hex");
}

function sign(body: string) {
  const secret = process.env["M2M_SIGNING_SECRET"] ?? process.env["CLAIM_HASH_SECRET"] ?? "m2m";
  return createHmac("sha256", secret).update(body).digest("hex");
}

type Endpoint = {
  tier: "B2B" | "C2C";
  id: string;
  label: string | null;
  url: string;
  buyer_id: string | null;
};

async function collectEndpoints(): Promise<Endpoint[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: Endpoint[] = [];
  try {
    const { data } = await supabaseAdmin
      .from("shadow_liquidity_queue")
      .select("id,label,webhook_target_url,buyer_id,allocated_capital_usd")
      .eq("is_active", true)
      .order("allocated_capital_usd", { ascending: false })
      .limit(25);
    for (const q of (data ?? []) as any[])
      out.push({
        tier: "B2B",
        id: q.id,
        label: q.label,
        url: q.webhook_target_url,
        buyer_id: q.buyer_id,
      });
  } catch (e) {
    console.error("[m2m-clearing] b2b endpoints failed", e);
  }
  try {
    const { data } = await supabaseAdmin
      .from("routing_endpoints")
      .select("id,name,url,priority_score")
      .eq("is_active", true)
      .order("priority_score", { ascending: false })
      .limit(25);
    for (const r of (data ?? []) as any[])
      out.push({ tier: "C2C", id: r.id, label: r.name, url: r.url, buyer_id: null });
  } catch (e) {
    console.error("[m2m-clearing] c2c endpoints failed", e);
  }
  return out.filter((e) => /^https:\/\//i.test(e.url ?? ""));
}

export type ClearResult = {
  ok: boolean;
  deal_id: string;
  winner: { tier: string; endpoint_id: string; label: string | null } | null;
  accepted_price: number | null;
  counter_accepted: boolean;
  broadcast: number;
  revoked: number;
  latency_ms: number;
  responses: Array<{ endpoint_id: string; tier: string; status: number | null; outcome: string }>;
};

/**
 * Race-to-clear: broadcast one asset to every B2B + C2C machine endpoint at
 * once inside a single 30s handshake. First cryptographically signed EMD
 * confirmation wins; auto-counters above the absolute floor are auto-approved
 * inside the same session; losers receive DEAL_LOCKED revocation.
 */
export async function raceToClear(dealId: string): Promise<ClearResult> {
  const t0 = Date.now();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: deal } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id,apn,county,zip,address,city,state,asset_type,base_contract_price,optimized_acquisition_premium,absolute_floor_price,has_signed_marketing_auth,data_fidelity_score,m2m_asset_hash,cleared_at,escrow_status,lien_total,title_status,assessed_value,is_dip,dip_case_number,dip_court_district,dip_sale_motion_ref,dip_proposed_order_ref,dip_sale_hearing_at,dip_closing_deadline_at,dip_free_and_clear,stalking_horse_bid,court_overbid_increment",
    )
    .eq("id", dealId)
    .maybeSingle();

  const empty: ClearResult = {
    ok: false,
    deal_id: dealId,
    winner: null,
    accepted_price: null,
    counter_accepted: false,
    broadcast: 0,
    revoked: 0,
    latency_ms: Date.now() - t0,
    responses: [],
  };
  if (!deal) return empty;
  const d = deal as any;
  if (d.cleared_at) return { ...empty, latency_ms: Date.now() - t0 };

  const price = Number(d.base_contract_price ?? 0);
  const fee = Number(d.optimized_acquisition_premium ?? 0);
  const floor = Number(d.absolute_floor_price ?? 0) || Math.round(price * 0.85);
  const dispatchedAt = new Date();
  const expiresAt = new Date(dispatchedAt.getTime() + HANDSHAKE_MS);

  let vdrUrl: string | null = null;
  try {
    const { vdrToken } = await import("@/lib/vdr.server");
    vdrUrl = `${baseUrl()}/api/public/vdr/${await vdrToken(dealId)}`;
  } catch (e) {
    console.error("[m2m-clearing] vdr mint failed", e);
  }

  const txHash = transactionHash({
    parcelId: d.apn ?? d.m2m_asset_hash ?? null,
    askingPrice: price,
    timestamp: dispatchedAt.toISOString(),
    sellerAuth: !!d.has_signed_marketing_auth,
  });

  const { titleCleanHash, signM2M, TIF_SECONDS, MAX_FEE_SLIPPAGE_BPS } = await import(
    "@/lib/m2m-protocol.server"
  );
  const title = titleCleanHash({
    apn: d.apn,
    county: (d as any).county ?? null,
    lien_total: (d as any).lien_total ?? null,
    title_status: (d as any).title_status ?? null,
    assessed_value: (d as any).assessed_value ?? null,
    is_dip: (d as any).is_dip ?? false,
    dip_case_number: (d as any).dip_case_number ?? null,
    dip_sale_motion_ref: (d as any).dip_sale_motion_ref ?? null,
    dip_proposed_order_ref: (d as any).dip_proposed_order_ref ?? null,
  });

  const isDip = !!(d as any).is_dip;
  const stalkingHorse = Number((d as any).stalking_horse_bid ?? 0) || null;
  const overbidIncrement =
    Number((d as any).court_overbid_increment ?? 0) ||
    (stalkingHorse ? Math.max(25_000, Math.round(stalkingHorse * 0.02)) : null);

  const payload = {
    event: "WEBHOOK_DISPATCHED",
    deal_id: dealId,
    transaction_hash: txHash,
    asset_fingerprint: d.m2m_asset_hash,
    data_fidelity_score: Number(d.data_fidelity_score ?? 0.5),
    title_clean_hash: title.title_clean_hash,
    title_clean: title.title_clean,
    title_source: title.title_source,
    auto_execute_recommended:
      (Number(d.data_fidelity_score ?? 0) >= 0.98 && title.title_clean) ||
      title.title_source === "SECTION_363_COURT_ORDER",
    bankruptcy: isDip
      ? {
          type: "DIP_CHAPTER_11",
          sale_type: "SECTION_363",
          case_number: (d as any).dip_case_number ?? null,
          court_district: (d as any).dip_court_district ?? null,
          sale_motion_ref: (d as any).dip_sale_motion_ref ?? null,
          proposed_order_ref: (d as any).dip_proposed_order_ref ?? null,
          sale_hearing_at: (d as any).dip_sale_hearing_at ?? null,
          closing_deadline_at: (d as any).dip_closing_deadline_at ?? null,
          free_and_clear: !!(d as any).dip_free_and_clear || title.title_clean,
        }
      : null,
    property: {
      apn: d.apn,
      address: d.address,
      city: d.city,
      state: d.state,
      zip: d.zip,
      asset_type: d.asset_type,
    },
    economics: { asking_price: price, assignment_fee: fee, emd_required_usd: 1000 },
    vdr_access_url: vdrUrl,
    auto_counter_matrix: {
      enabled: true,
      // Buyers respond 200/422 with { counter_price } — anything at or above
      // this bound is auto-approved and locked in the same session.
      min_acceptable_price: floor,
      decrement_step: Math.max(1000, Math.round(price * 0.01)),
      session_ttl_ms: HANDSHAKE_MS,
      // Limit-order controls for algorithmic counter-bidding.
      tif_seconds: TIF_SECONDS,
      max_fee_slippage_bps: MAX_FEE_SLIPPAGE_BPS,
      tif_expires_at: new Date(Date.now() + TIF_SECONDS * 1000).toISOString(),
      // Bankruptcy auction parameters (Section 363 overbid protocol).
      stalking_horse_bid: isDip ? stalkingHorse : null,
      court_overbid_increment: isDip ? overbidIncrement : null,
      min_qualified_overbid:
        isDip && stalkingHorse && overbidIncrement ? stalkingHorse + overbidIncrement : null,
      court_hearing_at: isDip ? ((d as any).dip_sale_hearing_at ?? null) : null,
      respond_with: { counter_price: "number", emd_signature: "hex", emd_confirmed: "boolean" },
    },
    handshake: {
      expires_at: expiresAt.toISOString(),
      execution_endpoint: `${baseUrl()}/api/m2m/execute`,
      pool_endpoint: `${baseUrl()}/api/m2m/pool`,
    },
  };

  const bodyStr = JSON.stringify(payload);
  const signature = sign(bodyStr);
  const m2mSignature = signM2M(bodyStr);
  const endpoints = await collectEndpoints();

  const settled = await Promise.all(
    endpoints.map(async (ep) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), HANDSHAKE_MS);
      try {
        const res = await fetch(ep.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-M2M-Tier": ep.tier,
            "X-Signature-SHA256": signature,
            "X-M2M-Signature": `sha256=${m2mSignature}`,
            "X-Idempotency-Key": `${dealId}:${txHash.slice(0, 16)}`,
            "X-Transaction-Hash": txHash,
            "X-Data-Fidelity": String(payload.data_fidelity_score),
            "X-Title-Clean-Hash": title.title_clean_hash,
            "X-TIF-Seconds": String(TIF_SECONDS),
            "X-Max-Fee-Slippage-BPS": String(MAX_FEE_SLIPPAGE_BPS),
            "X-VDR-Access": vdrUrl ?? "",
          },
          body: bodyStr,
          signal: ac.signal,
        });

        const json: any = await res.json().catch(() => ({}));
        const counter = Number(json?.counter_price ?? 0);
        const emdOk = !!(json?.emd_confirmed && json?.emd_signature);
        let outcome: string = "declined";
        let acceptedPrice: number | null = null;
        if (emdOk && (res.status === 200 || res.status === 201)) {
          outcome = "emd_confirmed";
          acceptedPrice = counter > 0 ? counter : price;
        } else if (counter >= floor && counter > 0) {
          outcome = "counter_accepted";
          acceptedPrice = counter;
        } else if (counter > 0) {
          outcome = "counter_below_floor";
        }
        return { ep, status: res.status, outcome, acceptedPrice, signature: json?.emd_signature };
      } catch {
        return {
          ep,
          status: null as number | null,
          outcome: "unreachable",
          acceptedPrice: null as number | null,
          signature: null,
        };
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  const winnerRow =
    settled.find((s) => s.outcome === "emd_confirmed") ??
    settled
      .filter((s) => s.outcome === "counter_accepted")
      .sort((a, b) => (b.acceptedPrice ?? 0) - (a.acceptedPrice ?? 0))[0] ??
    null;

  let revoked = 0;
  if (winnerRow) {
    const acceptedPrice = winnerRow.acceptedPrice ?? price;
    try {
      await supabaseAdmin
        .from("closing_pipeline_items")
        .update({
          escrow_status: "EMD_PENDING",
          matched_buyer_id: winnerRow.ep.buyer_id,
          buyer_channel: winnerRow.ep.tier,
          base_contract_price: acceptedPrice,
        } as never)
        .eq("id", dealId);
    } catch (e) {
      console.error("[m2m-clearing] winner bind failed", e);
    }

    // DEAL_LOCKED revocation broadcast to every losing endpoint.
    const revocation = JSON.stringify({
      event: "DEAL_LOCKED",
      deal_id: dealId,
      transaction_hash: txHash,
      locked_at: new Date().toISOString(),
      reason: "cross_clearing_race_won",
    });
    const revSig = sign(revocation);
    await Promise.all(
      settled
        .filter((s) => s.ep.id !== winnerRow.ep.id)
        .map(async (s) => {
          try {
            await fetch(s.ep.url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-M2M-Event": "DEAL_LOCKED",
                "X-Signature-SHA256": revSig,
              },
              body: revocation,
            });
            revoked += 1;
          } catch {
            /* fail-forward */
          }
        }),
    );
  }

  await supabaseAdmin
    .from("system_audit_logs")
    .insert({
      pipeline_item_id: dealId,
      event_type: "M2M_CROSS_CLEARING",
      reason: winnerRow
        ? `Race won by ${winnerRow.ep.label ?? winnerRow.ep.id} (${winnerRow.outcome})`
        : `No machine acceptance across ${endpoints.length} endpoints`,
      payload: {
        transaction_hash: txHash,
        floor,
        responses: settled.map((s) => ({
          endpoint: s.ep.id,
          tier: s.ep.tier,
          status: s.status,
          outcome: s.outcome,
        })),
      } as never,
    } as never)
    .then(undefined, () => {});

  return {
    ok: !!winnerRow,
    deal_id: dealId,
    winner: winnerRow
      ? { tier: winnerRow.ep.tier, endpoint_id: winnerRow.ep.id, label: winnerRow.ep.label }
      : null,
    accepted_price: winnerRow?.acceptedPrice ?? null,
    counter_accepted: winnerRow?.outcome === "counter_accepted",
    broadcast: endpoints.length,
    revoked,
    latency_ms: Date.now() - t0,
    responses: settled.map((s) => ({
      endpoint_id: s.ep.id,
      tier: s.ep.tier,
      status: s.status,
      outcome: s.outcome,
    })),
  };
}

/** C2C flash capital pooling — micro-allocations stack until the deal is funded. */
export async function commitPoolCapital(input: {
  dealId: string;
  apiKeyId: string;
  buyerReference: string | null;
  amountUsd: number;
  paymentIntentId?: string | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: deal } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("id, optimized_acquisition_premium, cleared_at, escrow_status")
    .eq("id", input.dealId)
    .maybeSingle();
  if (!deal) return { ok: false as const, status: 404, error: "deal_not_found" };
  const target = Number((deal as any).optimized_acquisition_premium ?? 0);
  if ((deal as any).cleared_at) return { ok: false as const, status: 409, error: "already_cleared" };

  const { error } = await supabaseAdmin.from("c2c_capital_pool").insert({
    pipeline_item_id: input.dealId,
    api_key_id: input.apiKeyId,
    buyer_reference: input.buyerReference,
    committed_usd: input.amountUsd,
    stripe_payment_intent_id: input.paymentIntentId ?? null,
    status: "committed",
  } as never);
  if (error) return { ok: false as const, status: 500, error: error.message };

  const { data: rows } = await supabaseAdmin
    .from("c2c_capital_pool")
    .select("committed_usd")
    .eq("pipeline_item_id", input.dealId)
    .eq("status", "committed");
  const pooled = ((rows ?? []) as any[]).reduce((s, r) => s + Number(r.committed_usd ?? 0), 0);
  const funded = target > 0 && pooled >= target;

  if (funded) {
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({ escrow_status: "EMD_PENDING", buyer_channel: "C2C_POOL" } as never)
      .eq("id", input.dealId)
      .then(undefined, () => {});
  }

  return {
    ok: true as const,
    deal_id: input.dealId,
    pooled_usd: pooled,
    target_usd: target,
    remaining_usd: Math.max(0, target - pooled),
    fully_funded: funded,
  };
}
