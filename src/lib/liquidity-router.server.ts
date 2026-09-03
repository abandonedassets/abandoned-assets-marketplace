// Algorithmic Liquidity Router — pure M2M outbound fan-out + inbound bid strike.
// No humans. We blast blinded JSON to institutional Buy-Box endpoints and accept
// the highest machine bid that clears the threshold.
import { createHash } from "crypto";

const DISPATCH_TIMEOUT_MS = 8000;
const MAX_CONSECUTIVE_FAILURES = 3;
/** Circuit-broken endpoints stay active but get starved of alpha. */
const TARPIT_DELAY_MS = 3500;
/** Sealed-bid first-price auction window. */
const AUCTION_WINDOW_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Randomized +1%..+6% markup so quants cannot regress our floor from the tape. */
function dispersionMarkup() {
  return 1 + (0.01 + Math.random() * 0.05);
}

export function hashKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function addressHash(row: Record<string, any>) {
  return createHash("sha256")
    .update(`${row["address"] ?? ""}|${row["zip"] ?? ""}`.toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

/**
 * Standardized machine payload — Data Gating Protocol.
 * Broadcast: zip, asset class, yield, title status. Sealed: address, parcel,
 * city, GPS. The machine buys the map by authorizing the fee, never before.
 */
export function buildM2MPayload(
  row: Record<string, any>,
  quotedPrice?: number,
  gate?: { yield: Record<string, unknown>; gate: Record<string, unknown> },
) {
  const price = Number(quotedPrice ?? row["base_contract_price"] ?? 0);
  return {
    schema: "m2m.asset.offer/2.0",
    asset_id: row["id"],
    address_hash: addressHash(row),
    market: { state: row["state"] ?? null, zip: row["zip"] ?? null },
    asset_class: row["cre_class"] ?? row["asset_type"] ?? "SFR",
    timber_mbf_volume: row["timber_mbf"] ?? null,
    locked_price_usd: Math.round(price * 100) / 100,
    // Floor intentionally omitted — never expose the true minimum to the tape.
    ...(gate?.yield ?? {}),
    ...(gate?.gate ?? {}),
    bid_endpoint: `${process.env["PUBLIC_SITE_URL"] ?? "https://abandonedasset.online"}/api/public/hooks/m2m-bid-receive`,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}


/** Fan-out a single asset to every eligible active institutional endpoint. */
export async function fanOutAsset(dealId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: row } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("*")
    .eq("id", dealId)
    .maybeSingle();
  if (!row) return { ok: false as const, error: "deal_not_found" };

  const r = row as Record<string, any>;
  const price = Number(r["base_contract_price"] ?? 0);
  const assetClass = String(r["cre_class"] ?? r["asset_type"] ?? "SFR");

  const { data: hooks } = await supabaseAdmin
    .from("institutional_webhooks")
    .select("*")
    .eq("active", true);

  const targets = ((hooks ?? []) as Record<string, any>[]).filter((h) => {
    if (price && Number(h["min_deal_size_usd"] ?? 0) > price) return false;
    if (price && Number(h["max_deal_size_usd"] ?? 1e12) < price) return false;
    const classes: string[] = Array.isArray(h["target_asset_classes"]) ? h["target_asset_classes"] : [];
    if (classes.length && !classes.includes(assetClass)) return false;
    return true;
  });

  const results = await Promise.all(
    targets.map(async (h) => {
      const tarpit = String(h["status"] ?? "HEALTHY").toUpperCase() === "TARPIT";
      // Tarpit: keep them as backup liquidity but starve them of alpha.
      if (tarpit) await sleep(TARPIT_DELAY_MS);

      const markup = dispersionMarkup();
      const quoted = Math.round(price * markup * 100) / 100;
      const { yieldBlock, gateBlock, scrubSealed } = await import("./data-gate.server");
      const base = buildM2MPayload(r, quoted, { yield: yieldBlock(r), gate: gateBlock(r) });
      // Apex: synthetic volume bait + schema morphing into the target's dialect.
      const { morphPayload, trackedLiquidity } = await import("./apex-discovery.server");
      const bait = await trackedLiquidity(r["zip"] ?? null, r["state"] ?? null);
      const payload = scrubSealed({
        ...(morphPayload({ ...base }, h["schema_map"] as never) as Record<string, unknown>),
        metadata: scrubSealed(bait as Record<string, unknown>),
      }) as typeof base & { metadata: unknown };

      await supabaseAdmin
        .from("dispersed_quotes")
        .insert({
          pipeline_item_id: dealId,
          webhook_id: h["id"],
          api_key_hash: h["api_key_hash"] ?? null,
          base_price: price,
          markup_pct: Math.round((markup - 1) * 10000) / 100,
          quoted_price: quoted,
          expires_at: base.expires_at,
        } as never)
        .then(undefined, () => {});

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), DISPATCH_TIMEOUT_MS);
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (h["outbound_api_key"]) {
          const header = String(h["auth_header"] ?? "Authorization");
          headers[header] =
            header.toLowerCase() === "authorization"
              ? `Bearer ${h["outbound_api_key"]}`
              : String(h["outbound_api_key"]);
        }
        const resp = await fetch(String(h["endpoint_url"]), {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        const strikes = resp.ok ? 0 : Number(h["consecutive_failures"] ?? 0) + 1;
        await supabaseAdmin
          .from("institutional_webhooks")
          .update({
            last_dispatch_at: new Date().toISOString(),
            last_status: String(resp.status),
            consecutive_failures: strikes,
            // Never disabled — bad algos get tarpitted, not deleted.
            active: true,
            status: strikes >= MAX_CONSECUTIVE_FAILURES ? "TARPIT" : resp.ok ? "HEALTHY" : h["status"] ?? "HEALTHY",
          } as never)
          .eq("id", h["id"]);
        return { endpoint: h["label"], ok: resp.ok, status: resp.status, quoted, tarpit };
      } catch (e) {
        const strikes = Number(h["consecutive_failures"] ?? 0) + 1;
        await supabaseAdmin
          .from("institutional_webhooks")
          .update({
            last_dispatch_at: new Date().toISOString(),
            last_status: (e as Error).message.slice(0, 120),
            consecutive_failures: strikes,
            active: true,
            status: strikes >= MAX_CONSECUTIVE_FAILURES ? "TARPIT" : h["status"] ?? "HEALTHY",
          } as never)
          .eq("id", h["id"]);
        return { endpoint: h["label"], ok: false, error: (e as Error).message, quoted, tarpit };
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  await supabaseAdmin
    .from("system_audit_logs")
    .insert({
      pipeline_item_id: dealId,
      event_type: "M2M_LIQUIDITY_FANOUT",
      reason: `Dispatched to ${targets.length} institutional endpoints (asymmetric dispersion)`,
      payload: { results } as never,
    } as never)
    .then(undefined, () => {});

  return { ok: true as const, dispatched: targets.length, results };
}


/** Sweep every REVERSE_STRIKE_READY asset and fan it out. Fail-forward. */
export async function fanOutReadyAssets(limit = 25) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("id,enrichment_tags")
    .not("status", "in", '("Closed","Dead","Funds-Cleared","Auto_Archived_Bad_Data")')
    .order("updated_at", { ascending: true })
    .limit(limit * 4);

  const ready = ((data ?? []) as Record<string, any>[])
    .filter((r) => {
      const tags: string[] = Array.isArray(r["enrichment_tags"]) ? r["enrichment_tags"] : [];
      return tags.includes("REVERSE_STRIKE_READY") && !tags.includes("M2M_FANOUT_SENT");
    })
    .slice(0, limit);

  const out: unknown[] = [];
  for (const r of ready) {
    try {
      const res = await fanOutAsset(String(r["id"]));
      const tags: string[] = Array.isArray(r["enrichment_tags"]) ? r["enrichment_tags"] : [];
      await supabaseAdmin
        .from("closing_pipeline_items")
        .update({ enrichment_tags: [...new Set([...tags, "M2M_FANOUT_SENT"])] } as never)
        .eq("id", r["id"]);
      out.push({ id: r["id"], ...res });
    } catch (e) {
      out.push({ id: r["id"], error: (e as Error).message });
    }
  }
  return { ok: true as const, swept: ready.length, results: out };
}

export type BidInput = {
  buyer_api_key: string;
  asset_id: string;
  bid_amount: number;
  stripe_payment_intent: string;
  buyer_reference?: string | null;
};

/**
 * Algorithmic Strike Engine: validate the machine, score the bid against the
 * required threshold, and — if it clears — lock, debit, and flash-bridge with
 * zero human approval.
 */
export async function ingestAlgorithmicBid(input: BidInput) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: hook } = await supabaseAdmin
    .from("institutional_webhooks")
    .select("id,label,active")
    .eq("api_key_hash", hashKey(input.buyer_api_key))
    .maybeSingle();
  const h = hook as Record<string, any> | null;
  if (!h || h["active"] === false) return { ok: false as const, status: 403, error: "unauthorized" };

  const { data: deal } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("id,status,base_contract_price,absolute_floor_price,cleared_at,m2m_expires_at")
    .eq("id", input.asset_id)
    .maybeSingle();
  const d = deal as Record<string, any> | null;
  if (!d) return { ok: false as const, status: 404, error: "asset_not_found" };
  if (d["cleared_at"]) return { ok: false as const, status: 409, error: "already_cleared" };

  // Validate against the exact price THIS machine was quoted (asymmetric dispersion).
  const { data: quote } = await supabaseAdmin
    .from("dispersed_quotes")
    .select("quoted_price")
    .eq("pipeline_item_id", input.asset_id)
    .eq("api_key_hash", hashKey(input.buyer_api_key))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const quoted = Number((quote as Record<string, any> | null)?.["quoted_price"] ?? 0) || null;

  const threshold =
    quoted ||
    Number(d["absolute_floor_price"] ?? 0) ||
    Number(d["base_contract_price"] ?? 0) ||
    0;
  const clears = threshold > 0 && input.bid_amount >= threshold;

  const windowId = `${input.asset_id}:${Math.floor(Date.now() / AUCTION_WINDOW_MS)}`;
  const bidRow = {
    pipeline_item_id: input.asset_id,
    webhook_id: h["id"],
    buyer_label: input.buyer_reference ?? h["label"],
    bid_amount: input.bid_amount,
    required_threshold: threshold,
    quoted_price: quoted,
    auction_window_id: windowId,
    payment_intent: input.stripe_payment_intent.slice(0, 200),
    status: clears ? "PENDING_AUCTION" : "BELOW_THRESHOLD",
    reason: clears ? "sealed-bid window" : `bid ${input.bid_amount} < quote ${threshold}`,
    raw_payload: input as never,
  };
  const { data: inserted } = await supabaseAdmin
    .from("m2m_bids")
    .insert(bidRow as never)
    .select("id")
    .maybeSingle();
  const bidId = (inserted as Record<string, any> | null)?.["id"] ?? null;

  if (!clears) {
    return {
      ok: false as const,
      status: 409,
      error: "bid_below_threshold",
      required: threshold,
      bid_id: bidId,
    };
  }

  // First-price sealed bid: hold the window open, then take the highest.
  await sleep(AUCTION_WINDOW_MS);

  const { data: competing } = await supabaseAdmin
    .from("m2m_bids")
    .select("id,bid_amount,created_at,status")
    .eq("pipeline_item_id", input.asset_id)
    .eq("auction_window_id", windowId)
    .order("bid_amount", { ascending: false })
    .order("created_at", { ascending: true });

  const pool = ((competing ?? []) as Record<string, any>[]).filter(
    (b) => b["status"] === "PENDING_AUCTION" || b["status"] === "ACCEPTED",
  );
  const winner = pool[0];
  if (winner && bidId && winner["id"] !== bidId) {
    await supabaseAdmin
      .from("m2m_bids")
      .update({ status: "OUTBID", reason: `outbid by ${winner["bid_amount"]}` } as never)
      .eq("id", bidId);
    return {
      ok: false as const,
      status: 409,
      error: "outbid",
      winning_bid: Number(winner["bid_amount"] ?? 0),
      bid_id: bidId,
    };
  }

  // Re-check the asset was not locked mid-window.
  const { data: fresh } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("cleared_at,m2m_expires_at,locked_by_api_key_id")
    .eq("id", input.asset_id)
    .maybeSingle();
  const f = fresh as Record<string, any> | null;
  if (f?.["cleared_at"]) return { ok: false as const, status: 409, error: "already_cleared" };
  if (
    f?.["m2m_expires_at"] &&
    new Date(String(f["m2m_expires_at"])).getTime() > Date.now() &&
    f["locked_by_api_key_id"] &&
    f["locked_by_api_key_id"] !== h["id"]
  ) {
    await supabaseAdmin
      .from("m2m_bids")
      .update({ status: "OUTBID", reason: "asset locked by prior strike" } as never)
      .eq("id", bidId);
    return { ok: false as const, status: 409, error: "outbid", bid_id: bidId };
  }

  if (bidId) {
    await supabaseAdmin
      .from("m2m_bids")
      .update({ status: "ACCEPTED", reason: "auto-strike (highest sealed bid)" } as never)
      .eq("id", bidId);
  }


  // Lock the asset to this machine for the execution window.
  const expires = new Date(Date.now() + 15 * 60_000).toISOString();
  await supabaseAdmin
    .from("closing_pipeline_items")
    .update({
      m2m_expires_at: expires,
      lock_phase: "STRIKE_CLAIMED",
      locked_by_api_key_id: h["id"],
      stripe_session_id: input.stripe_payment_intent,
    } as never)
    .eq("id", input.asset_id);

  // Scarcity lock: a real strike buys this peering key 30 more days.
  try {
    const { extendPeeringKey } = await import("./apex-discovery.server");
    await extendPeeringKey(String(h["id"]));
  } catch (e) {
    console.error("[apex] extend key failed", e);
  }


  // Direct-debit mandate + flash bridge, fail-forward.
  const steps: Record<string, unknown> = {};
  let gatewayFailed = false;
  try {
    const { pullBuyerCapital, flashBridge } = await import("./forced-settlement.server");
    const pull: any = await pullBuyerCapital({
      dealId: input.asset_id,
      amountUsd: input.bid_amount,
    } as never);
    steps["capital_pull"] = pull;
    if (pull && pull.ok === false) gatewayFailed = true;
    steps["flash_bridge"] = await flashBridge(input.asset_id);
  } catch (e) {
    steps["error"] = (e as Error).message;
    gatewayFailed = true;
  }

  // DIRECT-WIRE PIVOT — never reject the machine when the card rail glitches.
  if (gatewayFailed) {
    const { wireConfig, BENEFICIARY_NAME } = await import("./bluevine.server");
    const cfg = wireConfig();
    await supabaseAdmin
      .from("system_audit_logs")
      .insert({
        pipeline_item_id: input.asset_id,
        event_type: "M2M_ALTERNATE_ROUTING",
        reason: `Card rail failed; issued direct Bluevine wire instructions for ${input.bid_amount}`,
        payload: { steps } as never,
      } as never)
      .then(undefined, () => {});
    try {
      const { notifyAdmin, fmtUsd } = await import("./notify.server");
      await notifyAdmin(
        `SYSTEM ALERT: GATEWAY FAILED — ALTERNATE ROUTING ISSUED FOR ${fmtUsd(input.bid_amount)}. ASSET ${input.asset_id.slice(0, 8)} LOCKED, AWAITING DIRECT WIRE.`,
        true,
      );
    } catch {}
    return {
      ok: true as const,
      status: 202,
      routing: "ALTERNATE_ROUTING" as const,
      asset_id: input.asset_id,
      accepted_bid: input.bid_amount,
      lock_expires_at: expires,
      instructions:
        "Card gateway locked. Wire the assignment fee directly alongside the property wire to unlock coordinates immediately.",
      wire: {
        beneficiary: BENEFICIARY_NAME,
        bank: cfg.bank,
        bank_address: cfg.address,
        routing_number: cfg.routing,
        account_number: cfg.account,
        amount_usd: input.bid_amount,
        memo: `Assignment Fee — Deal ${input.asset_id.slice(0, 8)}`,
      },
      settlement: steps,
    };
  }


  await supabaseAdmin
    .from("system_audit_logs")
    .insert({
      pipeline_item_id: input.asset_id,
      event_type: "M2M_ALGORITHMIC_STRIKE",
      reason: `Machine bid ${input.bid_amount} accepted from ${h["label"]}`,
      payload: { bid: bidRow, steps } as never,
    } as never)
    .then(undefined, () => {});

  return {
    ok: true as const,
    status: 200,
    asset_id: input.asset_id,
    accepted_bid: input.bid_amount,
    lock_expires_at: expires,
    settlement: steps,
  };
}
