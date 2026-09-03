// DUAL-RAIL CRYPTOGRAPHIC BRIDGE
// Rail 1 (Stripe): non-refundable micro Data Access Toll ($250–$500). Clears
//   instantly, proves the buying node's treasury is real, never trips AML.
// Rail 2 (Bluevine): the millisecond the toll capture is signature-verified,
//   coordinates release and the heavy assignment balance is instructed via
//   Bluevine ACH pull / Fedwire.
// State only moves on a cryptographically verified gateway event — never on a
// generated instruction. Fail-forward: nothing here throws into a webhook.

const API = "https://api.stripe.com/v1";
const TOLL_TTL_SECONDS = 6 * 3600;

export function tollAmountUsd(): number {
  const raw = Number(process.env["DATA_ACCESS_TOLL_USD"] ?? 350);
  if (!isFinite(raw) || raw <= 0) return 350;
  return Math.min(500, Math.max(250, Math.round(raw)));
}

function key() {
  return process.env["STRIPE_SECRET_KEY"] ?? process.env["STRIPE_RESTRICTED_KEY"] ?? "";
}

async function stripe(
  path: string,
  init?: { method?: string; body?: URLSearchParams; idem?: string },
): Promise<{ ok: boolean; status: number; json: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${key()}` };
  if (init?.body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (init?.idem) headers["Idempotency-Key"] = init.idem;
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers,
    ...(init?.body ? { body: init.body } : {}),
  });
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export type TollResult =
  | { ok: true; url: string; session_id: string; amount_usd: number; expires_at: number; reused: boolean }
  | { ok: false; status: number; error: string; detail?: string };

const COLS =
  "id, zip, status, cleared_at, optimized_acquisition_premium, base_contract_price, toll_status, toll_intent_id, toll_session_url, toll_amount_usd, stripe_session_id, stripe_session_expires_at";

/** RAIL 1 — mint (or reuse) the instant micro-toll that unlocks the asset. */
export async function createDataAccessToll(
  dealId: string,
  origin: string,
  opts: { buyerEmail?: string | null; buyerKeyId?: string | null; forceFresh?: boolean } = {},
): Promise<TollResult> {
  if (!dealId) return { ok: false, status: 400, error: "deal_id_required" };
  if (!key()) return { ok: false, status: 503, error: "stripe_key_missing" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: deal, error } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(COLS)
    .eq("id", dealId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "lookup_failed", detail: error.message };
  if (!deal) return { ok: false, status: 404, error: "deal_not_found" };

  const d = deal as any;
  if (d.cleared_at) return { ok: false, status: 409, error: "already_cleared" };
  if (d.toll_status === "paid")
    return { ok: false, status: 409, error: "toll_already_paid" };

  if (
    !opts.forceFresh &&
    d.toll_status === "pending" &&
    d.toll_session_url &&
    d.stripe_session_expires_at &&
    new Date(d.stripe_session_expires_at).getTime() - Date.now() > 300_000
  ) {
    return {
      ok: true,
      url: d.toll_session_url,
      session_id: String(d.stripe_session_id ?? ""),
      amount_usd: Number(d.toll_amount_usd ?? tollAmountUsd()),
      expires_at: Math.floor(new Date(d.stripe_session_expires_at).getTime() / 1000),
      reused: true,
    };
  }

  const toll = tollAmountUsd();
  const fee = Number(d.optimized_acquisition_premium ?? 0);
  const balance = Math.max(0, fee - toll);
  const expiresAt = Math.floor(Date.now() / 1000) + TOLL_TTL_SECONDS;

  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(toll * 100),
    "line_items[0][price_data][product_data][name]": "Data Access Toll — Digital Asset Dossier",
    "line_items[0][price_data][product_data][description]":
      "Non-refundable option toll for machine access to sealed asset coordinates and the digital contract assignment binder. Credited against the assignment balance.",
    "payment_intent_data[description]": `Data access toll — asset ${dealId.slice(0, 8)}`,
    "payment_intent_data[statement_descriptor_suffix]": "DATA TOLL",
    expires_at: String(expiresAt),
    success_url: `${origin}/admin/terminal?toll_paid=${dealId}`,
    cancel_url: `${origin}/admin/terminal?toll_abandoned=${dealId}`,
    submit_type: "pay",
  });
  const meta: Record<string, string> = {
    rail: "data_access_toll",
    deal_id: String(dealId),
    toll_usd: String(toll),
    assignment_balance_usd: String(balance),
    zip: String(d.zip ?? ""),
  };
  if (opts.buyerKeyId) meta["buyer_key_id"] = String(opts.buyerKeyId);
  for (const [k, v] of Object.entries(meta)) {
    body.append(`metadata[${k}]`, v);
    body.append(`payment_intent_data[metadata][${k}]`, v);
  }
  if (opts.buyerEmail) body.append("customer_email", opts.buyerEmail);

  const res = await stripe("/checkout/sessions", {
    method: "POST",
    body,
    idem: `toll_${dealId}_${toll}${opts.forceFresh ? `_${Date.now()}` : ""}`,
  });
  if (!res.ok || !res.json?.url) {
    return {
      ok: false,
      status: 502,
      error: "toll_session_failed",
      detail: res.json?.error?.message ?? `http_${res.status}`,
    };
  }

  try {
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        toll_status: "pending",
        toll_amount_usd: toll,
        toll_session_url: res.json.url,
        toll_buyer_key_id: opts.buyerKeyId ?? null,
        balance_due_usd: balance,
        stripe_session_id: res.json.id,
        stripe_session_expires_at: new Date(expiresAt * 1000).toISOString(),
      } as never)
      .eq("id", dealId);
  } catch (e) {
    console.error("[dual-rail] toll persist failed", e);
  }

  return {
    ok: true,
    url: res.json.url,
    session_id: res.json.id,
    amount_usd: toll,
    expires_at: expiresAt,
    reused: false,
  };
}

export type TollWebhookResult = {
  handled: boolean;
  deal_id?: string | null;
  intent?: string | null;
  unlock?: unknown;
  balance?: unknown;
};

/**
 * RAIL 1 -> RAIL 2 bridge. Called ONLY from the signature-verified Stripe
 * webhook lane. Marks the toll paid, releases coordinates, then instructs the
 * Bluevine heavy settlement for the assignment balance.
 */
export async function handleTollEvent(event: any): Promise<TollWebhookResult> {
  const type = String(event?.type ?? "");
  const obj = event?.data?.object ?? {};
  const meta = obj?.metadata ?? {};
  if (meta?.rail !== "data_access_toll") return { handled: false };

  const dealId: string | null = meta?.deal_id ?? null;
  if (!dealId) return { handled: false };

  const paid =
    (type === "checkout.session.completed" && obj?.payment_status === "paid") ||
    type === "payment_intent.succeeded" ||
    type === "charge.succeeded";
  if (!paid) return { handled: false };

  const intent =
    typeof obj?.payment_intent === "string" ? obj.payment_intent : (obj?.id ?? null);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: prior } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("id, toll_status, balance_due_usd, optimized_acquisition_premium")
    .eq("id", dealId)
    .maybeSingle();
  const p = prior as any;
  if (!p) return { handled: false };
  if (p.toll_status === "paid")
    return { handled: true, deal_id: dealId, intent, unlock: "already_unlocked" };

  await supabaseAdmin
    .from("closing_pipeline_items")
    .update({
      toll_status: "paid",
      toll_intent_id: intent,
      toll_paid_at: new Date().toISOString(),
    } as never)
    .eq("id", dealId);

  // Zero-latency coordinate release.
  let unlock: unknown = null;
  try {
    const { deliverUnlockPacket } = await import("@/lib/data-gate.server");
    unlock = await deliverUnlockPacket(dealId);
  } catch (e) {
    console.error("[dual-rail] unlock delivery failed", e);
  }

  const balance = await instructHeavySettlement(dealId);

  try {
    await supabaseAdmin.from("system_audit_logs").insert({
      pipeline_item_id: dealId,
      event_type: "DUAL_RAIL_TOLL_CLEARED",
      reason: "Stripe micro-toll verified; Bluevine heavy settlement instructed",
      payload: { intent, unlock, balance } as never,
    } as never);
  } catch {}

  return { handled: true, deal_id: dealId, intent, unlock, balance };
}

/** RAIL 2 — Bluevine instruction for the assignment balance. Idempotent. */
export async function instructHeavySettlement(
  dealId: string,
): Promise<{ ok: boolean; ref?: string; url?: string; amount_usd?: number; error?: string }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id, zip, optimized_acquisition_premium, toll_amount_usd, balance_due_usd, balance_rail_ref, balance_rail_status",
      )
      .eq("id", dealId)
      .maybeSingle();
    const d = row as any;
    if (!d) return { ok: false, error: "deal_not_found" };
    if (d.balance_rail_ref)
      return { ok: true, ref: d.balance_rail_ref, amount_usd: Number(d.balance_due_usd ?? 0) };

    const fee = Number(d.optimized_acquisition_premium ?? 0);
    const toll = Number(d.toll_amount_usd ?? tollAmountUsd());
    const amount = Number(d.balance_due_usd ?? Math.max(0, fee - toll));
    if (amount <= 0) return { ok: true, amount_usd: 0 };

    const { issueAchDebit } = await import("@/lib/bluevine-rails.server");
    const rail = await issueAchDebit({
      dealId,
      amountUsd: amount,
      memo: `Assignment balance (toll credited) — deal ${dealId.slice(0, 8)} · ZIP ${d.zip ?? "—"}`,
      counterpartyRef: dealId,
      idempotencyKey: `bv_balance_${dealId}`,
    });
    if (!rail.ok) return { ok: false, error: rail.error };

    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        balance_rail_ref: rail.id,
        balance_rail_status: rail.status,
        balance_due_usd: amount,
        balance_instructed_at: new Date().toISOString(),
      } as never)
      .eq("id", dealId);

    return { ok: true, ref: rail.id, url: rail.url, amount_usd: amount };
  } catch (e) {
    console.error("[dual-rail] heavy settlement failed", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Algorithmic reputation stacking — a node that pays the toll to harvest
 * coordinates and then never settles the balance gets its key burned and its
 * liquidity score slashed.
 */
export async function burnDefaultingBuyer(
  keyId: string,
  reason: string,
): Promise<{ ok: boolean; cancellation_count?: number }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: k } = await supabaseAdmin
      .from("institutional_api_keys")
      .select("id, label, cancellation_count, liquidity_score")
      .eq("id", keyId)
      .maybeSingle();
    const row = k as any;
    if (!row) return { ok: false };

    const count = Number(row.cancellation_count ?? 0) + 1;
    const score = Math.max(0, Number(row.liquidity_score ?? 100) - 40);
    await supabaseAdmin
      .from("institutional_api_keys")
      .update({
        cancellation_count: count,
        liquidity_score: score,
        is_active: count < 2,
        blacklisted_at: count >= 2 ? new Date().toISOString() : null,
      } as never)
      .eq("id", keyId);

    await supabaseAdmin
      .from("system_audit_logs")
      .insert({
        event_type: "BUYER_REPUTATION_BURN",
        reason: `${row.label ?? keyId}: ${reason}`,
        payload: { key_id: keyId, cancellation_count: count, liquidity_score: score } as never,
      } as never)
      .then(undefined, () => {});

    return { ok: true, cancellation_count: count };
  } catch (e) {
    console.error("[dual-rail] burn failed", e);
    return { ok: false };
  }
}

/** Sweep: toll paid, balance never funded within the grace window -> burn. */
export async function sweepTollDefaults(
  graceHours = 24,
): Promise<{ scanned: number; burned: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cutoff = new Date(Date.now() - graceHours * 3600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("id, toll_buyer_key_id, toll_paid_at, cleared_at, balance_rail_status")
    .eq("toll_status", "paid")
    .is("cleared_at", null)
    .lt("toll_paid_at", cutoff)
    .limit(200);

  const rows = (data ?? []) as any[];
  let burned = 0;
  for (const r of rows) {
    if (!r.toll_buyer_key_id) continue;
    const res = await burnDefaultingBuyer(
      r.toll_buyer_key_id,
      `toll paid but assignment balance unfunded after ${graceHours}h on ${r.id}`,
    );
    if (res.ok) burned++;
    try {
      await supabaseAdmin
        .from("closing_pipeline_items")
        .update({ balance_rail_status: "defaulted" } as never)
        .eq("id", r.id);
    } catch {}
  }
  return { scanned: rows.length, burned };
}
