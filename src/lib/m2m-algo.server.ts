import { maskedLabel } from "./address-mask";
import { DISPATCH_TIMEOUT_MS, routeToDlq } from "./dlq.server";
// High-Frequency M2M Algorithmic Protocol.
// Dual-speed execution:
//   * execution_mode = 'M2M'   -> JSON payload posted to the fund's webhook,
//                                 15-minute handshake window, auto-waterfall.
//   * execution_mode = 'HUMAN' -> existing 15-minute web reservation timer.
// Fail-forward: any single buyer/asset failure never stalls the run.

// 15-minute window: bank feeds / Stripe webhooks can lag minutes; 60s caused
// false lock-thrashing by ripping assets away from funded buyers mid-settle.
export const M2M_WINDOW_SECONDS = 900;
export const M2M_EMD_USD = 100;
// 3-strike circuit breaker: after 3 consecutive node failures the box is
// frozen (circuit_open) and the payload parked in the dead-letter vault so a
// degraded third-party can't get our API keys rate-limited/blacklisted.
export const M2M_MAX_CONSECUTIVE_FAILURES = 3;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export const M2M_CORS = CORS;

function bearerOf(request: Request): string {
  const raw = request.headers.get("authorization") ?? "";
  if (raw.toLowerCase().startsWith("bearer ")) return raw.slice(7).trim();
  return (request.headers.get("x-api-key") ?? "").trim();
}

async function wirePayload(dealId: string, memo: string, amount: number) {
  try {
    const { wireConfig } = await import("@/lib/bluevine.server");
    const cfg = wireConfig();
    if (!cfg.routing || !cfg.account) return null;
    return {
      bank_name: cfg.bank,
      bank_address: cfg.address,
      account_name: cfg.beneficiary,
      beneficiary_address: cfg.beneficiaryAddress,
      routing_number: String(cfg.routing),
      account_number: String(cfg.account),
      rail: "Domestic Fedwire / ACH",
      amount_usd: amount,
      memo_id: memo,
      reference: `${memo} · ${dealId.slice(0, 8).toUpperCase()}`,
    };
  } catch {
    return null;
  }
}

/** Raw inbound probe log — every hit on the M2M endpoints, authorized or not. */
export async function logInbound(entry: {
  request: Request;
  endpoint: string;
  key?: string;
  authorized?: boolean;
  boxLabel?: string | null;
  status: number;
  latencyMs: number;
  bodyPreview?: string | null;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const h: Record<string, string> = {};
    entry.request.headers.forEach((v, k) => {
      h[k] = /authorization|api-key|cookie/i.test(k) ? `${v.slice(0, 6)}…` : v.slice(0, 200);
    });
    await supabaseAdmin.from("m2m_inbound_log").insert({
      endpoint: entry.endpoint,
      method: entry.request.method,
      ip:
        entry.request.headers.get("cf-connecting-ip") ??
        entry.request.headers.get("x-forwarded-for"),
      user_agent: entry.request.headers.get("user-agent"),
      api_key_prefix: entry.key ? entry.key.slice(0, 10) : null,
      authorized: Boolean(entry.authorized),
      box_label: entry.boxLabel ?? null,
      http_status: entry.status,
      latency_ms: entry.latencyMs,
      body_preview: entry.bodyPreview ? entry.bodyPreview.slice(0, 800) : null,
      headers: h as never,
    } as never);
  } catch (e) {
    console.error("[m2m] inbound log failed", e);
  }
}

/** POST /api/v1/m2m/accept — sub-second algorithmic handshake. */
export async function handleM2MAccept(request: Request): Promise<Response> {
  const t0 = Date.now();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const endpoint = new URL(request.url).pathname;

  const key = bearerOf(request);
  if (!key) {
    await logInbound({ request, endpoint, status: 401, latencyMs: Date.now() - t0 });
    return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });
  }

  const { data: box } = await supabaseAdmin
    .from("buyer_buy_boxes")
    .select("id, label, active, m2m_api_key, execution_mode")
    .eq("m2m_api_key", key)
    .maybeSingle();
  const label = (box as any)?.label ?? null;
  if (!box || !(box as any).active) {
    await logInbound({ request, endpoint, key, status: 401, latencyMs: Date.now() - t0 });
    return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });
  }

  let raw = "";
  let body: any;
  try {
    raw = await request.text();
    body = JSON.parse(raw);
  } catch {
    await logInbound({
      request, endpoint, key, authorized: true, boxLabel: label,
      status: 400, latencyMs: Date.now() - t0, bodyPreview: raw,
    });
    return Response.json({ error: "invalid_json" }, { status: 400, headers: CORS });
  }

  const propertyId = String(body?.property_id ?? body?.deal_id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(propertyId)) {
    await logInbound({
      request, endpoint, key, authorized: true, boxLabel: label,
      status: 400, latencyMs: Date.now() - t0, bodyPreview: raw,
    });
    return Response.json({ error: "invalid_property_id" }, { status: 400, headers: CORS });
  }
  const signature = body?.signature ? String(body.signature).slice(0, 512) : null;

  // --- Sovereign gates: cryptographic fee lock + deterministic sequencer ---
  const { feeLock, verifyFeeAck, sequencerClaim, nextAvailableAsset } = await import(
    "@/lib/sovereign-m2m.server"
  );

  const { data: dealRow } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("id, base_contract_price, optimized_acquisition_premium")
    .eq("id", propertyId)
    .maybeSingle();
  if (!dealRow) {
    await logInbound({
      request, endpoint, key, authorized: true, boxLabel: label,
      status: 404, latencyMs: Date.now() - t0, bodyPreview: raw,
    });
    return Response.json({ error: "not_found" }, { status: 404, headers: CORS });
  }
  const dr = dealRow as any;
  const lock = feeLock(
    propertyId,
    Number(dr.base_contract_price ?? 0),
    Number(dr.optimized_acquisition_premium ?? 0),
  );

  const feeAck = request.headers.get("x-fee-ack") ?? (body?.fee_ack_hash ?? null);
  if (!verifyFeeAck(feeAck, lock.fee_ack_hash)) {
    await logInbound({
      request, endpoint, key, authorized: true, boxLabel: label,
      status: 402, latencyMs: Date.now() - t0, bodyPreview: raw,
    });
    return Response.json(
      {
        accepted: false,
        error: "FEE_ACK_REQUIRED",
        detail: "X-Fee-Ack must carry the HMAC of the locked fee equation.",
        fee_lock: {
          equation: lock.equation,
          contract_price: lock.contract_price,
          clearing_fee: lock.clearing_fee,
          total_wire_instruction: lock.total_wire_instruction,
        },
      },
      { status: 402, headers: CORS },
    );
  }

  const claim = await sequencerClaim({
    dealId: propertyId,
    buyerRef: String((box as any).id),
    mode: "FIRM",
    feeAckHash: lock.fee_ack_hash,
  });
  if (!claim.ok && claim.status === 409) {
    await logInbound({
      request, endpoint, key, authorized: true, boxLabel: label,
      status: 409, latencyMs: Date.now() - t0, bodyPreview: raw,
    });
    return Response.json(
      {
        accepted: false,
        error: "ASSET_CLEARED",
        winner_ref: claim.winner_ref ?? null,
        next_asset: await nextAvailableAsset(propertyId),
      },
      { status: 409, headers: CORS },
    );
  }



  const { data, error } = await supabaseAdmin.rpc("m2m_accept" as never, {
    _id: propertyId,
    _box_id: (box as any).id,
    _signature: signature,
  } as never);

  if (error) {
    await logInbound({
      request, endpoint, key, authorized: true, boxLabel: label,
      status: 500, latencyMs: Date.now() - t0, bodyPreview: raw,
    });
    return Response.json({ error: "accept_failed", message: error.message }, { status: 500, headers: CORS });
  }
  const res = (data ?? {}) as any;
  if (!res.ok) {
    const status = res.error === "not_found" ? 404 : 409;
    await logInbound({
      request, endpoint, key, authorized: true, boxLabel: label,
      status, latencyMs: Date.now() - t0, bodyPreview: raw,
    });
    return Response.json({ accepted: false, reason: res.error }, { status, headers: CORS });
  }

  await logInbound({
    request, endpoint, key, authorized: true, boxLabel: label,
    status: 200, latencyMs: Date.now() - t0, bodyPreview: raw,
  });

  const wire = await wirePayload(propertyId, res.memo_id, Number(res.price ?? 0));

  return Response.json(
    {
      accepted: true,
      property_id: propertyId,
      state: "WIRE_PENDING_VERIFICATION",
      memo_id: res.memo_id,
      assignment_fee: Number(res.assignment_fee ?? 0),
      price: Number(res.price ?? 0),
      emd_amount: M2M_EMD_USD,
      wire_instructions: wire,
      elapsed_ms: Date.now() - t0,
    },
    { status: 200, headers: { ...CORS, "Cache-Control": "no-store" } },
  );
}

type DispatchOut = {
  ok: boolean;
  boxes: number;
  dispatched: number;
  instant_accepts: number;
  errors: number;
};

/** Per-node telemetry: reachability, latency, HTTP status, accept ratio. */
export async function recordNodeHealth(
  box: { id: string; label?: string | null; webhook_url?: string | null },
  r: { status: number | null; latency: number; error: string | null; accepted: boolean },
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ok = !r.error && r.status !== null && r.status < 400;
    const { data: prev } = await supabaseAdmin
      .from("m2m_node_health")
      .select("consecutive_failures,total_attempts,total_accepts,last_success_at")
      .eq("box_id", box.id)
      .maybeSingle();
    const p = (prev ?? {}) as any;
    const now = new Date().toISOString();
    const failures = ok ? 0 : Number(p.consecutive_failures ?? 0) + 1;
    // 3-strike circuit breaker: freeze the box and park the payload in the
    // dead-letter vault instead of hammering a degraded endpoint.
    if (failures >= M2M_MAX_CONSECUTIVE_FAILURES) {
      try {
        await supabaseAdmin
          .from("buyer_buy_boxes")
          .update({ endpoint_status: "circuit_open" } as never)
          .eq("id", box.id)
          .neq("endpoint_status", "circuit_open" as never);
        await supabaseAdmin.from("dead_letter_payloads").insert({
          source: "m2m_dispatch",
          event_id: `circuit-open:${box.id}:${now}`,
          raw_body: JSON.stringify({
            box_id: box.id,
            label: box.label ?? null,
            webhook_url: box.webhook_url ?? null,
            consecutive_failures: failures,
            last_error: r.error,
            last_status: r.status,
          }),
          error_log: `CIRCUIT_OPEN: ${failures} consecutive failures (${r.error ?? `HTTP ${r.status}`})`,
          status: "PENDING_RETRY",
        } as never);
      } catch (e) {
        console.error("[m2m] circuit breaker write failed", e);
      }
    }
    await supabaseAdmin.from("m2m_node_health").upsert(
      {
        box_id: box.id,
        label: box.label ?? null,
        webhook_url: box.webhook_url ?? null,
        last_attempt_at: now,
        last_success_at: ok ? now : (p.last_success_at ?? null),
        last_status: r.status,
        last_latency_ms: r.latency,
        last_error: r.error ? r.error.slice(0, 300) : null,
        consecutive_failures: failures,
        total_attempts: Number(p.total_attempts ?? 0) + 1,
        total_accepts: Number(p.total_accepts ?? 0) + (r.accepted ? 1 : 0),
        reachable: ok,
        updated_at: now,
      } as never,
      { onConflict: "box_id" },
    );
  } catch (e) {
    console.error("[m2m] node health write failed", e);
  }
}

/** Outbound algorithmic dispatch: JSON payload -> fund API, 15-min handshake. */
export async function dispatchM2MWaterfall(limitPerBox = 5): Promise<DispatchOut> {
  const out: DispatchOut = { ok: true, boxes: 0, dispatched: 0, instant_accepts: 0, errors: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: boxes } = await supabaseAdmin
    .from("buyer_buy_boxes")
    .select(
      "id, label, webhook_url, m2m_api_key, max_contract_price, target_zip_codes, target_asset_types, endpoint_status, endpoint_checked_at",
    )
    .eq("active", true)
    .eq("execution_mode", "M2M")
    .not("webhook_url", "is", null);

  if (!boxes?.length) return out;
  out.boxes = boxes.length;

  const { preflightBuyBox } = await import("@/lib/endpoint-verify.server");

  for (const b of boxes as any[]) {
    try {
      // Circuit breaker: a tripped node stays frozen until manually reset.
      if (b.endpoint_status === "circuit_open") continue;
      // Live-only gate: never push a packet to an unverified/synthetic endpoint.
      const pre = await preflightBuyBox(b);
      if (!pre.ok) continue;
      // NOTE: two chained .or() filters produced an invalid PostgREST query and
      // silently returned zero rows — that was the reason nothing ever dispatched.
      // Eligibility (payout state / in-flight window) is enforced atomically by
      // the m2m_claim_dispatch RPC, so we only pre-filter on buy-box criteria.
      let q = supabaseAdmin
        .from("closing_pipeline_items")
        .select(
          "id, address, apn, zip, state, asset_type, base_contract_price, optimized_acquisition_premium, calculated_arv, title_status, status, signed_contract_hash",
        )
        .is("cleared_at", null)
        .order("optimized_acquisition_premium", { ascending: false })
        .limit(limitPerBox * 4);

      if (b.max_contract_price) q = q.lte("base_contract_price", b.max_contract_price);
      if (Array.isArray(b.target_zip_codes) && b.target_zip_codes.length)
        q = q.in("zip", b.target_zip_codes);
      if (Array.isArray(b.target_asset_types) && b.target_asset_types.length)
        q = q.in("asset_type", b.target_asset_types);

      const { data: deals, error: dealErr } = await q;
      if (dealErr) {
        console.error("[m2m] deal scan failed", b.label, dealErr.message);
        out.errors += 1;
        await recordNodeHealth(b, { status: null, latency: 0, error: `scan: ${dealErr.message}`, accepted: false });
        continue;
      }
      let sentForBox = 0;
      for (const d of (deals ?? []) as any[]) {
        try {
          const { data: claim } = await supabaseAdmin.rpc("m2m_claim_dispatch" as never, {
            _id: d.id,
            _box_id: b.id,
            _window_seconds: M2M_WINDOW_SECONDS,
          } as never);
          if (!(claim as any)?.ok) continue;

          const memoId = `BV-${String(d.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`;
          const { feeLock, verifyFeeAck, greyPoolFlag } = await import(
            "@/lib/sovereign-m2m.server"
          );
          const lock = feeLock(
            String(d.id),
            Number(d.base_contract_price ?? 0),
            Number(d.optimized_acquisition_premium ?? 0),
          );
          const grey = greyPoolFlag(d.status, d.signed_contract_hash ?? null);
          const payload = {
            property_id: d.id,
            apn: d.apn ?? null,
            address: maskedLabel({ address: d.address, zip: d.zip, apn: d.apn }),
            address_masked: true,
            zip: d.zip ?? null,
            state: d.state ?? null,
            asset_type: d.asset_type ?? null,
            arv: Number(d.calculated_arv ?? 0),
            price: Number(d.base_contract_price ?? 0),
            assignment_fee: Number(d.optimized_acquisition_premium ?? 0),
            emd_amount: M2M_EMD_USD,
            title_status: d.title_status ?? null,
            signature_hash: d.signed_contract_hash ?? null,
            // Locked equation — the buyer machine must echo fee_ack_hash back.
            fee_lock: lock,
            required_ack_header: "X-Fee-Ack",
            ...grey,
            dynamic_memo_id: memoId,
            handshake_window_seconds: M2M_WINDOW_SECONDS,
            accept_endpoint: "/api/v1/m2m/accept",
          };


          const t0 = Date.now();
          let httpStatus: number | null = null;
          let accepted = false;
          let transportError: string | null = null;
          try {
            const { createHash } = await import("crypto");
            const idem = createHash("sha256")
              .update(`${d.id}|${d.apn ?? d.address ?? ""}|${Number(d.base_contract_price ?? 0)}`)
              .digest("hex");
            const resp = await fetch(b.webhook_url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Deal-ID": String(d.id),
                "X-Idempotency-Key": idem,
                "X-Execution-TTL-MS": "3000",
                "X-Fee-Lock-Equation": lock.equation,
                "X-Fee-Ack-Required": "1",
                "X-Grey-Pool": grey.grey_pool ? "1" : "0",
                "X-Signature-Hash": String(d.signed_contract_hash ?? ""),
                "X-Settlement-Hook": "https://abandonedasset.online/api/public/hooks/stripe-settlement",
                "X-Settlement-Routing-ID": `STRIPE_SETTLEMENT:${memoId}`,
                "X-Settlement-Binder-URL": `https://abandonedasset.online/api/private/m2m/settlement-binder/${d.id}`,
              },

              body: JSON.stringify(payload),
              // Bi-directional ACK/NACK: 5s hard ceiling per node.
              signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
            });

            httpStatus = resp.status;
            const j = (await resp.json().catch(() => null)) as any;
            // 200 OK == machine interest -> unlock the 3-pillar settlement binder.
            if (resp.status === 200) {
              try {
                const { binderUrl } = await import("@/lib/settlement-binder.server");
                await supabaseAdmin
                  .from("offer_delivery_logs")
                  .insert({
                    contract_id: d.id,
                    status: "BINDER_UNLOCKED",
                    meta: {
                      channel: "M2M",
                      box_id: b.id,
                      binder_url: binderUrl(String(d.id)),
                      header: "X-Settlement-Binder-URL",
                    } as any,
                  } as any);
              } catch (e) {
                console.error("[m2m] binder unlock log failed", e);
              }
            }
            accepted = resp.ok && (j?.accept === true || j?.accepted === true);
            // Cryptographic fee lock: an acceptance without a valid X-Fee-Ack
            // is a fee-strip attempt -> drop the connection, cascade the asset.
            if (accepted) {
              const ack = resp.headers.get("x-fee-ack") ?? j?.fee_ack_hash ?? null;
              if (!verifyFeeAck(ack, lock.fee_ack_hash)) {
                accepted = false;
                httpStatus = 402;
                transportError = "FEE_ACK_MISMATCH";
                console.error("[m2m] fee-ack rejected", b.label, d.id);
              }
            }

            if (accepted) {
              const { data: acc } = await supabaseAdmin.rpc("m2m_accept" as never, {
                _id: d.id,
                _box_id: b.id,
                _signature: j?.signature ? String(j.signature).slice(0, 512) : "inline_handshake",
              } as never);
              if ((acc as any)?.ok) out.instant_accepts += 1;
            }
          } catch (e) {
            transportError = e instanceof Error ? e.message : String(e);
            out.errors += 1;
          }

          const latency = Date.now() - t0;
          await recordNodeHealth(b, {
            status: httpStatus,
            latency,
            error: transportError,
            accepted,
          });

          // FAILSAFE: a transport error or 4xx/5xx is a network stutter, not an
          // abandonment. The hold is NOT stripped here — node health / the
          // 3-strike circuit breaker + dead-letter retry own the recovery, and
          // the asset only cascades when the 15-min clock bleeds out naturally.
          if (transportError || (httpStatus ?? 0) >= 500 || httpStatus === 408 || httpStatus === 429) {
            await routeToDlq({
              dealId: String(d.id),
              boxId: b.id,
              endpoint: b.webhook_url,
              httpStatus,
              error: transportError,
              payload,
            });
          }


          out.dispatched += 1;
          sentForBox += 1;
          await supabaseAdmin
            .from("offer_delivery_logs")
            .insert({
              contract_id: d.id,
              status: accepted ? "EXECUTED" : transportError || (httpStatus ?? 0) >= 400 ? "FAILED" : "SENT",
              meta: {
                channel: "M2M",
                box_id: b.id,
                buyer: b.label,
                http_status: httpStatus,
                latency_ms: latency,
                error: transportError,
              } as any,
            } as any);
          if (sentForBox >= limitPerBox) break;
        } catch {
          out.errors += 1;
        }
      }
    } catch {
      out.errors += 1;
    }
  }

  return out;
}

/** Timeout sweep — revoke lapsed 15-min holds, re-cascade to next fund. */
export async function sweepM2MTimeouts(): Promise<{ ok: boolean; revoked: number; error?: string }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("sweep_expired_m2m" as never);
    if (error) return { ok: false, revoked: 0, error: error.message };
    return { ok: true, revoked: ((data as unknown[]) ?? []).length };
  } catch (e) {
    return { ok: false, revoked: 0, error: (e as Error).message };
  }
}
