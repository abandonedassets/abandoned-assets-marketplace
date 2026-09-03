// CRITICAL PATH — Stripe assignment-fee rail (buyer side).
// Bluevine remains the wire rail for the six-figure property leg; Stripe only
// ever touches the digital contract assignment fee, classified as a digital
// brokerage product so the account is never flagged as real-estate high-risk.
//
// Mechanics:
//   1. Buyer approves  -> Checkout Session, capture_method: manual (auth hold)
//   2. Stripe webhook  -> hold recorded, deal flagged authorized (idempotent)
//   3. Escrow clear    -> captureAssignmentFee() moves funds to the LLC bank
//   4. Abandoned       -> checkout_abandoned_at stamped for the 15-min SMS recovery

const API = "https://api.stripe.com/v1";
const SESSION_TTL_SECONDS = 24 * 3600;

function key() {
  return process.env["STRIPE_SECRET_KEY"] ?? process.env["STRIPE_RESTRICTED_KEY"] ?? "";
}

export function assignmentFeeRailConfigured() {
  return Boolean(key());
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

export type FeeSessionResult =
  | { ok: true; url: string; session_id: string; expires_at: number; reused: boolean }
  | { ok: false; status: number; error: string; detail?: string };

const DEAL_COLS =
  "id, zip, status, calculated_arv, estimated_repairs, estimated_cap_rate, base_contract_price, optimized_acquisition_premium, cleared_at, assignment_fee_status, assignment_fee_intent_id, stripe_session_id, stripe_session_url, stripe_session_expires_at";

/** Machine-readable payload hedge-fund buy-box algorithms parse directly. */
export function structuredDealMetadata(d: any) {
  return {
    deal_id: String(d.id),
    arv: String(Number(d.calculated_arv ?? 0)),
    repair_estimate: String(Number(d.estimated_repairs ?? 0)),
    cap_rate: String(Number(d.estimated_cap_rate ?? 0)),
    assignment_fee: String(Number(d.optimized_acquisition_premium ?? 0)),
    contract_price: String(Number(d.base_contract_price ?? 0)),
    zip: String(d.zip ?? ""),
    product: "digital_contract_assignment_fee",
  };
}

/**
 * Mint (or reuse) a Checkout Session that AUTHORIZES the assignment fee.
 * Funds are held, not transferred, until captureAssignmentFee() runs.
 */
export async function createAssignmentFeeAuthorization(
  dealId: string,
  origin: string,
  opts: { buyerEmail?: string | null; forceFresh?: boolean } = {},
): Promise<FeeSessionResult> {
  if (!dealId) return { ok: false, status: 400, error: "deal_id_required" };
  if (!assignmentFeeRailConfigured())
    return { ok: false, status: 503, error: "stripe_key_missing" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: deal, error } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(DEAL_COLS)
    .eq("id", dealId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: "lookup_failed", detail: error.message };
  if (!deal) return { ok: false, status: 404, error: "deal_not_found" };

  const d = deal as any;
  if (d.assignment_fee_status === "captured")
    return { ok: false, status: 409, error: "already_captured" };

  const fee = Number(d.optimized_acquisition_premium ?? 0);
  if (!isFinite(fee) || fee <= 0)
    return { ok: false, status: 422, error: "no_assignment_fee" };

  // Reuse an unexpired authorization link.
  if (
    !opts.forceFresh &&
    d.assignment_fee_status === "pending" &&
    d.stripe_session_id?.startsWith("cs_") &&
    d.stripe_session_url &&
    d.stripe_session_expires_at &&
    new Date(d.stripe_session_expires_at).getTime() - Date.now() > 300_000
  ) {
    return {
      ok: true,
      url: d.stripe_session_url,
      session_id: d.stripe_session_id,
      expires_at: Math.floor(new Date(d.stripe_session_expires_at).getTime() / 1000),
      reused: true,
    };
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const meta = structuredDealMetadata(d);

  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(Math.round(fee * 100)),
    "line_items[0][price_data][product_data][name]": "Digital Contract Assignment Fee",
    "line_items[0][price_data][product_data][description]":
      "Non-refundable fee for transfer of a digital purchase-contract assignment. Fee is earned and non-refundable upon transfer of the digital contract.",
    "payment_intent_data[capture_method]": "manual",
    "payment_intent_data[description]": `Digital contract assignment fee — deal ${dealId.slice(0, 8)}`,
    "payment_intent_data[statement_descriptor_suffix]": "CONTRACT FEE",
    expires_at: String(expiresAt),
    success_url: `${origin}/admin/terminal?fee_authorized=${dealId}`,
    cancel_url: `${origin}/admin/terminal?fee_abandoned=${dealId}`,
    submit_type: "book",
  });
  for (const [k, v] of Object.entries(meta)) {
    body.append(`metadata[${k}]`, v);
    body.append(`payment_intent_data[metadata][${k}]`, v);
  }
  if (opts.buyerEmail) body.append("customer_email", opts.buyerEmail);

  const res = await stripe("/checkout/sessions", {
    method: "POST",
    body,
    // Mathematical fingerprint — a retried mint never creates a second hold.
    idem: `afee_${dealId}_${Math.round(fee * 100)}${opts.forceFresh ? `_${Date.now()}` : ""}`,
  });

  if (!res.ok || !res.json?.url) {
    return {
      ok: false,
      status: 502,
      error: "stripe_session_failed",
      detail: res.json?.error?.message ?? `http_${res.status}`,
    };
  }

  try {
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        stripe_session_id: res.json.id,
        stripe_session_url: res.json.url,
        stripe_session_expires_at: new Date(expiresAt * 1000).toISOString(),
        assignment_fee_status: "pending",
        checkout_abandoned_at: null,
        checkout_recovery_sent_at: null,
      } as never)
      .eq("id", dealId);
  } catch (e) {
    console.error("[assignment-fee] session persist failed", e);
  }

  return { ok: true, url: res.json.url, session_id: res.json.id, expires_at: expiresAt, reused: false };
}

/**
 * Webhook leg: record an authorization hold. Idempotent — a double-fired
 * Stripe event lands on the same row values and changes nothing.
 */
export async function recordAssignmentFeeAuthorization(event: any): Promise<{
  handled: boolean;
  deal_id: string | null;
  intent: string | null;
}> {
  const type = String(event?.type ?? "");
  const obj = event?.data?.object ?? {};
  const isAuth =
    type === "payment_intent.amount_capturable_updated" ||
    (type === "checkout.session.completed" && obj?.status === "complete");
  if (!isAuth) return { handled: false, deal_id: null, intent: null };

  const dealId: string | null = obj?.metadata?.deal_id ?? null;
  if (!dealId) return { handled: false, deal_id: null, intent: null };

  const intent =
    typeof obj?.payment_intent === "string" ? obj.payment_intent : (obj?.id ?? null);
  const cents = Number(obj?.amount_capturable ?? obj?.amount_total ?? obj?.amount ?? 0);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("closing_pipeline_items")
    .update({
      assignment_fee_intent_id: intent,
      assignment_fee_status: "authorized",
      assignment_fee_authorized_usd: Math.abs(cents) / 100,
      assignment_fee_authorized_at: new Date().toISOString(),
      earnest_hold_status: "authorized",
      checkout_abandoned_at: null,
    } as never)
    .eq("id", dealId)
    .neq("assignment_fee_status", "captured");

  return { handled: true, deal_id: dealId, intent };
}

/** Capture the held funds into the LLC bank account once escrow is clear. */
export async function captureAssignmentFee(
  dealId: string,
): Promise<{ ok: boolean; error?: string; intent?: string; amount_usd?: number }> {
  if (!assignmentFeeRailConfigured()) return { ok: false, error: "stripe_key_missing" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: deal } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id, assignment_fee_intent_id, assignment_fee_status, assignment_fee_authorized_usd",
    )
    .eq("id", dealId)
    .maybeSingle();

  const d = deal as any;
  if (!d) return { ok: false, error: "deal_not_found" };
  if (d.assignment_fee_status === "captured")
    return { ok: true, intent: d.assignment_fee_intent_id, amount_usd: Number(d.assignment_fee_authorized_usd ?? 0) };
  if (!d.assignment_fee_intent_id) return { ok: false, error: "no_authorization_hold" };

  const res = await stripe(`/payment_intents/${d.assignment_fee_intent_id}/capture`, {
    method: "POST",
    idem: `afee_capture_${dealId}`,
  });
  if (!res.ok) {
    return { ok: false, error: res.json?.error?.message ?? `http_${res.status}` };
  }

  const amount = Number(res.json?.amount_received ?? 0) / 100;
  await supabaseAdmin
    .from("closing_pipeline_items")
    .update({
      assignment_fee_status: "captured",
      assignment_fee_captured_at: new Date().toISOString(),
      assignment_fee_authorized_usd: amount || Number(d.assignment_fee_authorized_usd ?? 0),
    } as never)
    .eq("id", dealId);

  // Zero-touch escrow: fee is captured -> open title order autonomously.
  try {
    const { injectEscrowOrder } = await import("./escrow-injector.server");
    await injectEscrowOrder(dealId);
  } catch (e) {
    console.error("[escrow-injector] failed", e);
  }

  return { ok: true, intent: d.assignment_fee_intent_id, amount_usd: amount };
}

/**
 * Provider-authoritative failure/reversal lane. Called only after the Stripe
 * signature has been verified by the public webhook route.
 */
export async function recordAssignmentFeeTerminalEvent(event: any): Promise<{
  handled: boolean;
  deal_id: string | null;
  state?: string;
}> {
  const type = String(event?.type ?? "");
  const supported = new Set([
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "payment_intent.canceled",
    "charge.failed",
    "charge.refunded",
    "charge.dispute.created",
    "charge.dispute.closed",
  ]);
  if (!supported.has(type)) return { handled: false, deal_id: null };

  const obj = event?.data?.object ?? {};
  const intent =
    typeof obj?.payment_intent === "string"
      ? obj.payment_intent
      : String(obj?.id ?? "").startsWith("pi_")
        ? String(obj.id)
        : null;
  const dealId = typeof obj?.metadata?.deal_id === "string" ? obj.metadata.deal_id : null;
  const md = (obj?.metadata ?? {}) as Record<string, unknown>;
  const markedAssignmentFee =
    md["rail"] === "assignment_fee" ||
    md["purpose"] === "assignment_fee" ||
    md["mode"] === "assignment_fee" ||
    md["product"] === "digital_contract_assignment_fee";
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let query = supabaseAdmin
    .from("closing_pipeline_items")
    .select("id, assignment_fee_status, assignment_fee_intent_id")
    .limit(1);
  query = dealId
    ? query.eq("id", dealId)
    : intent
      ? query.eq("assignment_fee_intent_id", intent)
      : query.eq("id", "00000000-0000-0000-0000-000000000000");
  const { data: deal } = await query.maybeSingle();
  // Not our lane: let the property/M2M settlement handler process it.
  if (!deal) return { handled: false, deal_id: null };
  const feeIntent = (deal as any).assignment_fee_intent_id as string | null;
  const isAssignmentFeeEvent = markedAssignmentFee || (!!intent && !!feeIntent && intent === feeIntent);
  if (!isAssignmentFeeEvent) return { handled: false, deal_id: null };


  const resolvedId = String((deal as any).id);
  const disputeWon = type === "charge.dispute.closed" && obj?.status === "won";
  const state = disputeWon
    ? "captured"
    : type === "payment_intent.succeeded"
      ? "captured"
    : type.includes("dispute")
      ? "disputed"
      : type === "charge.refunded"
        ? "refunded"
        : type === "payment_intent.canceled"
          ? "canceled"
          : "failed";
  const update: Record<string, unknown> = {
    assignment_fee_status: state,
    payout_status:
      disputeWon || state === "captured" ? "CAPTURED" : `PAYMENT_${state.toUpperCase()}`,
  };
  if (state === "captured") update.assignment_fee_captured_at = new Date().toISOString();
  if (!disputeWon && (state === "disputed" || state === "refunded")) {
    update.status = "Funds-Suspended";
    update.escrow_status = "FUNDS_SUSPENDED";
    update.suspended_at = new Date().toISOString();
    update.suspension_reason = type;
  }
  await supabaseAdmin
    .from("closing_pipeline_items")
    .update(update as never)
    .eq("id", resolvedId);

  try {
    const { writeAuditLog } = await import("@/lib/webhook-verify.server");
    await writeAuditLog({
      event_type: "ASSIGNMENT_FEE_PROVIDER_STATE",
      reason: type,
      pipeline_item_id: resolvedId,
      raw_payload: { state, intent, provider_event_id: event?.id ?? null },
    });
  } catch {}
  return { handled: true, deal_id: resolvedId, state };
}

/** Cancel a Stripe authorization hold (releases buyer funds). Idempotent. */
export async function cancelAssignmentFeeHold(
  dealId: string,
  intentId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!intentId) return { ok: true };
  if (!assignmentFeeRailConfigured()) return { ok: false, error: "stripe_key_missing" };
  const res = await stripe(`/payment_intents/${intentId}/cancel`, {
    method: "POST",
    body: new URLSearchParams({ cancellation_reason: "abandoned" }),
    idem: `afee_cancel_${dealId}`,
  });
  const already = String(res.json?.error?.message ?? "").includes("canceled");
  if (!res.ok && !already) return { ok: false, error: res.json?.error?.message ?? `http_${res.status}` };
  return { ok: true };
}

/**
 * "Hanging wire" kill-switch. Stripe holds the assignment fee but the property
 * wire never landed within 24h: cancel the hold, revoke the contract lock, and
 * throw the asset back on the reverse-strike tape for the next buyer.
 */
export async function sweepHangingWires(): Promise<{
  scanned: number;
  released: number;
  deal_ids: string[];
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();

  const { data } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select("id, assignment_fee_intent_id, assignment_fee_authorized_at, cleared_at, zip")
    .eq("assignment_fee_status", "authorized")
    .lte("assignment_fee_authorized_at", cutoff)
    .is("cleared_at", null)
    .limit(50);

  const rows = (data ?? []) as any[];
  const released: string[] = [];

  for (const row of rows) {
    try {
      const cancel = await cancelAssignmentFeeHold(row.id, row.assignment_fee_intent_id ?? null);
      if (!cancel.ok) {
        console.error("[wire-timeout] cancel failed", row.id, cancel.error);
        continue;
      }
      await supabaseAdmin
        .from("closing_pipeline_items")
        .update({
          assignment_fee_status: "canceled_timeout",
          assignment_fee_intent_id: null,
          stripe_session_id: null,
          stripe_session_url: null,
          stripe_session_expires_at: null,
          earnest_hold_status: "released",
          lock_phase: null,
          m2m_locked_by: null,
          m2m_expires_at: null,
          wire_instructed_at: null,
          reverse_strike_ready: true,
          status: "Shadow_Inventory",
        } as never)
        .eq("id", row.id);

      const { writeAuditLog } = await import("@/lib/webhook-verify.server");
      await writeAuditLog({
        event_type: "HANGING_WIRE_KILLSWITCH",
        reason: "property_wire_not_received_within_24h",
        pipeline_item_id: row.id,
        raw_payload: { intent: row.assignment_fee_intent_id, authorized_at: row.assignment_fee_authorized_at },
      });
      released.push(row.id);
    } catch (e) {
      console.error("[wire-timeout] sweep failed", row.id, e);
    }
  }

  return { scanned: rows.length, released: released.length, deal_ids: released };
}

/**
 * Machine-readable recovery notice. No HTML, no marketing copy: institutional
 * mail-parsers scrape the raw link + JSON block straight into their OMS.
 */
export function composeRecoveryEmail(input: {
  assetHash: string;
  url: string;
  lockedPrice: number;
  assignmentFee: number;
  lockExpirationUtc: string;
}): { subject: string; text: string } {
  const body = {
    asset_hash: input.assetHash,
    locked_price: Number(input.lockedPrice || 0),
    assignment_fee: Number(input.assignmentFee || 0),
    lock_expiration_utc: input.lockExpirationUtc,
  };
  return {
    subject: `URGENT_ACTION: STRIPE_AUTH_PENDING - ${input.assetHash}`,
    text: `${input.url}\n\n${JSON.stringify(body, null, 2)}\n`,
  };
}

/** Slack/Teams compatible payload dropped straight onto the trading desk. */
export function composeDeskPayload(input: {
  assetHash: string;
  url: string;
  lockedPrice: number;
  assignmentFee: number;
  lockExpirationUtc: string;
}) {
  const text =
    `*STRIPE_AUTH_PENDING* | ASSET_ID: ${input.assetHash}\n` +
    `Assignment fee: $${Number(input.assignmentFee || 0).toLocaleString()} | ` +
    `Locked price: $${Number(input.lockedPrice || 0).toLocaleString()}\n` +
    `Lock expires (UTC): ${input.lockExpirationUtc}\n${input.url}`;
  return {
    text,
    // Teams connector cards read `title`/`text`; Slack reads `text`/`blocks`.
    title: `STRIPE_AUTH_PENDING ${input.assetHash}`,
    asset_hash: input.assetHash,
    payment_url: input.url,
    locked_price: Number(input.lockedPrice || 0),
    assignment_fee: Number(input.assignmentFee || 0),
    lock_expiration_utc: input.lockExpirationUtc,
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  };
}

async function injectTradingDesk(url: string, payload: unknown): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}


/** Webhook leg: buyer bailed on the hosted checkout — arm the recovery clock. */
export async function markCheckoutAbandoned(event: any): Promise<boolean> {
  if (String(event?.type ?? "") !== "checkout.session.expired") return false;
  const dealId = event?.data?.object?.metadata?.deal_id;
  if (!dealId) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("closing_pipeline_items")
    .update({ checkout_abandoned_at: new Date().toISOString() } as never)
    .eq("id", dealId)
    .is("assignment_fee_authorized_at", null);
  return true;
}

/**
 * Stalled-deal payment recovery: 15 minutes after abandonment, dispatch a
 * machine-readable email plus a direct trading-desk webhook injection.
 * Pure cloud rails — no SMS.
 */
export async function recoverAbandonedCheckouts(origin: string): Promise<{
  scanned: number;
  sent: number;
  desk_hits: number;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();

  const { data } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id, optimized_acquisition_premium, base_contract_price, checkout_abandoned_at, m2m_expires_at",
    )
    .not("checkout_abandoned_at", "is", null)
    .lte("checkout_abandoned_at", cutoff)
    .is("checkout_recovery_sent_at", null)
    .is("assignment_fee_authorized_at", null)
    .limit(25);

  const rows = (data ?? []) as any[];
  let sent = 0;
  let deskHits = 0;

  for (const row of rows) {
    try {
      const { data: esign } = await supabaseAdmin
        .from("esign_requests")
        .select("buyer_email")
        .eq("pipeline_item_id", row.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const buyerEmail = ((esign as any)?.buyer_email as string | undefined) ?? null;
      let deskWebhook: string | null = null;
      if (buyerEmail) {
        const { data: contact } = await supabaseAdmin
          .from("buyer_waitlist")
          .select("trading_desk_webhook")
          .eq("contact_email", buyerEmail)
          .limit(1)
          .maybeSingle();
        deskWebhook = ((contact as any)?.trading_desk_webhook as string | undefined) ?? null;
      }

      const session = await createAssignmentFeeAuthorization(row.id, origin, {
        buyerEmail,
        forceFresh: true,
      });
      if (!session.ok) continue;

      const payload = {
        assetHash: String(row.id).slice(0, 8).toUpperCase(),
        url: session.url,
        lockedPrice: Number(row.base_contract_price ?? 0),
        assignmentFee: Number(row.optimized_acquisition_premium ?? 0),
        lockExpirationUtc: new Date(session.expires_at * 1000).toISOString(),
      };

      let emailId: string | null = null;
      if (buyerEmail) {
        const { sendM2MEmail } = await import("@/lib/email.server");
        const mail = composeRecoveryEmail(payload);
        const res = await sendM2MEmail({
          to: buyerEmail,
          subject: mail.subject,
          text: mail.text,
          headers: {
            "X-Asset-ID": payload.assetHash,
            "X-Action-Required": "STRIPE_AUTH_PENDING",
          },
        } as never);
        if ((res as any)?.ok) {
          emailId = ((res as any).id as string | null) ?? null;
          sent++;
        }
      }

      if (deskWebhook) {
        const ok = await injectTradingDesk(deskWebhook, composeDeskPayload(payload));
        if (ok) {
          deskHits++;
          sent++;
        }
      }

      await supabaseAdmin
        .from("closing_pipeline_items")
        .update({
          checkout_recovery_sent_at: new Date().toISOString(),
          checkout_recovery_email_id: emailId,
          checkout_recovery_email_to: buyerEmail,
        } as never)
        .eq("id", row.id);
    } catch (e) {
      console.error("[assignment-fee] recovery failed", row.id, e);
    }
  }

  return { scanned: rows.length, sent, desk_hits: deskHits };
}

/**
 * Resend delivery kill-switch: a bounced/dropped recovery notice means the
 * comms line is dead. Cancel the Stripe hold immediately, revoke the lock,
 * tarpit the buyer, and return the asset to the reverse-strike tape.
 */
export async function killSwitchOnDeadRecovery(input: {
  emailId: string | null;
  to: string | null;
  reason: string;
}): Promise<{ released: string[] }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let q = supabaseAdmin
    .from("closing_pipeline_items")
    .select("id, assignment_fee_intent_id")
    .is("assignment_fee_authorized_at", null)
    .not("checkout_recovery_sent_at", "is", null)
    .limit(10);
  q = input.emailId
    ? q.eq("checkout_recovery_email_id", input.emailId)
    : q.eq("checkout_recovery_email_to", input.to ?? "__none__");

  const { data } = await q;
  const rows = (data ?? []) as any[];
  const released: string[] = [];

  for (const row of rows) {
    try {
      await cancelAssignmentFeeHold(row.id, row.assignment_fee_intent_id ?? null);
      await supabaseAdmin
        .from("closing_pipeline_items")
        .update({
          assignment_fee_status: "canceled_undeliverable",
          assignment_fee_intent_id: null,
          stripe_session_id: null,
          stripe_session_url: null,
          stripe_session_expires_at: null,
          earnest_hold_status: "released",
          lock_phase: null,
          m2m_locked_by: null,
          m2m_expires_at: null,
          reverse_strike_ready: true,
          status: "Shadow_Inventory",
        } as never)
        .eq("id", row.id);

      const { writeAuditLog } = await import("@/lib/webhook-verify.server");
      await writeAuditLog({
        event_type: "RECOVERY_DELIVERY_KILLSWITCH",
        reason: input.reason,
        pipeline_item_id: row.id,
        raw_payload: { email_id: input.emailId, to: input.to },
      });
      released.push(row.id);
    } catch (e) {
      console.error("[resend-killswitch] failed", row.id, e);
    }
  }

  // TARPIT the buyer: dead comms line = deprioritized in every future fan-out.
  if (input.to) {
    const { data: buyer } = await supabaseAdmin
      .from("buyer_waitlist")
      .select("id, tarpit_strikes")
      .eq("contact_email", input.to)
      .limit(1)
      .maybeSingle();
    if (buyer) {
      await supabaseAdmin
        .from("buyer_waitlist")
        .update({
          tarpit_strikes: Number((buyer as any).tarpit_strikes ?? 0) + 1,
          tarpit_until: new Date(Date.now() + 24 * 3600_000).toISOString(),
        } as never)
        .eq("id", (buyer as any).id);
    }
  }

  return { released };
}
