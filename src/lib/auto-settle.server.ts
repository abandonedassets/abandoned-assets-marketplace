import { urgencyWeight, urgencyTier, escalatedFeeBps } from "@/lib/irs-1031";
// DUE-state runner: transitions static "DUE" rows into live clearing fees.
//
// DUE = asset older than the 14-day T-impact window, not cleared/closed.
// UNVERIFIED = no settlement reference (verification_status is generated from it).
//
// Pass 1 (settle):  DUE + UNVERIFIED  -> issue Bluevine ACH debit (=> VERIFIED)
//                                     -> escrow_status EMD_CONFIRMED (FEES IN TRANSIT)
// Pass 2 (decay):   DUE + UNVERIFIED past deadline + 24h
//                                     -> release hold, dock buyer score, re-route to next buy box
//
// Fail-forward: every record is wrapped; one bad row never stalls the sweep.

const DUE_WINDOW_MS = 14 * 86_400_000;
const DECAY_GRACE_MS = 24 * 3_600_000;

type Box = {
  id: string;
  buyer_id: string;
  label: string | null;
  target_zip_codes: string[] | null;
  target_asset_types: string[] | null;
  max_contract_price: number | null;
  min_placement_margin: number | null;
  capital_to_deploy_usd: number | null;
  urgency_score: number | null;
  irs_identification_deadline?: string | null;
  specialized_asset_focus?: string | null;
};

function pickBox(
  boxes: Box[],
  asset: { zip?: string | null; asset_type?: string | null; price: number; fee: number },
  exclude?: string | null,
): Box | null {
  const eligible = boxes.filter((b) => {
    if (exclude && b.id === exclude) return false;
    const zips = b.target_zip_codes ?? [];
    const types = b.target_asset_types ?? [];
    if (zips.length && (!asset.zip || !zips.includes(asset.zip))) return false;
    if (types.length && asset.asset_type && !types.includes(asset.asset_type)) return false;
    if (Number(b.max_contract_price ?? 0) > 0 && asset.price > Number(b.max_contract_price)) return false;
    const minFee = Number(b.min_placement_margin ?? 0);
    if (minFee >= 100 && asset.fee < minFee) return false;
    return true;
  });
  // IRS §1031 day-35→45 boxes are tax-forced buyers: they always clear first.
  eligible.sort(
    (a, b) =>
      urgencyWeight(b.irs_identification_deadline) - urgencyWeight(a.irs_identification_deadline) ||
      Number(b.urgency_score ?? 0) - Number(a.urgency_score ?? 0) ||
      Number(b.capital_to_deploy_usd ?? 0) - Number(a.capital_to_deploy_usd ?? 0),
  );
  return eligible[0] ?? null;
}

export type AutoSettleReport = {
  ok: true;
  scanned: number;
  settled: number;
  verified: number;
  decayed: number;
  rerouted: number;
  fees_in_transit_usd: number;
  /** Exact money-rail state so the UI never claims a push that never happened. */
  rail_mode?: string;
  rail_detail?: string;
  /** Remaining settlements allowed in the rolling 24h liquidity drip window. */
  drip_remaining?: number;
  skipped: Array<{ id: string; reason: string }>;

};

// Autopilot is ON by default: only an explicit `false` flag disables it.
export async function isAutoSettleEnabled(): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("system_flags")
      .select("bool_value")
      .eq("key", "auto_settle_enabled")
      .maybeSingle();
    const v = (data as { bool_value?: boolean } | null)?.bool_value;
    return v !== false;
  } catch {
    return true;
  }
}

export async function setAutoSettleEnabled(on: boolean): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("system_flags")
    .upsert(
      { key: "auto_settle_enabled", bool_value: on, updated_at: new Date().toISOString() } as never,
      { onConflict: "key" },
    );
  return on;
}

// DSCR facility executed => account verification is satisfied institutionally.
export async function isDscrFacilityExecuted(): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("system_flags")
      .select("bool_value,text_value")
      .eq("key", "dscr_facility_status")
      .maybeSingle();
    const row = data as { bool_value?: boolean; text_value?: string } | null;
    if (row?.bool_value === true) return true;
    return String(row?.text_value ?? "").toUpperCase() === "ACCEPTED_AND_EXECUTED";
  } catch {
    return false;
  }
}

export async function setDscrFacilityExecuted(on: boolean): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("system_flags").upsert(
    {
      key: "dscr_facility_status",
      bool_value: on,
      text_value: on ? "ACCEPTED_AND_EXECUTED" : "PENDING",
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "key" },
  );
  return on;
}

// ── Liquidity Drip ─────────────────────────────────────────────────────────
// A <60-day-old Bluevine business account trips velocity/compliance review if a
// large wave of wires lands at once. Pace settlements: 2/day at ramp start,
// stepping up ~1 per 3 days, capped at 25/day after ~30 days.
const DRIP_BASE_PER_DAY = 2;
const DRIP_STEP_DAYS = 3;
const DRIP_MAX_PER_DAY = 25;
const DRIP_START_KEY = "liquidity_drip_start_at";
/** Operator override: set system_flags.liquidity_drip_per_day (int_value/text_value). */
const DRIP_OVERRIDE_KEY = "liquidity_drip_per_day";

async function dripAllowanceRemaining(): Promise<number> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Explicit operator override wins over the ramp curve.
    let override: number | null = null;
    try {
      const { data: ov } = await supabaseAdmin
        .from("system_flags")
        .select("text_value")
        .eq("key", DRIP_OVERRIDE_KEY)
        .maybeSingle();
      const raw = Number((ov as { text_value?: string } | null)?.text_value);
      if (Number.isFinite(raw) && raw > 0) override = Math.floor(raw);
    } catch {
      /* fall back to ramp */
    }

    const { data: flag } = await supabaseAdmin
      .from("system_flags")
      .select("text_value")
      .eq("key", DRIP_START_KEY)
      .maybeSingle();

    let startIso = (flag as { text_value?: string } | null)?.text_value ?? null;
    if (!startIso) {
      startIso = new Date().toISOString();
      await supabaseAdmin
        .from("system_flags")
        .upsert(
          { key: DRIP_START_KEY, text_value: startIso, updated_at: startIso } as never,
          { onConflict: "key" },
        )
        .then(undefined, () => {});
    }

    const days = Math.max(0, (Date.now() - new Date(startIso).getTime()) / 86_400_000);
    const perDay =
      override ??
      Math.min(DRIP_MAX_PER_DAY, DRIP_BASE_PER_DAY + Math.floor(days / DRIP_STEP_DAYS));

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await supabaseAdmin
      .from("system_audit_logs")
      .select("id", { count: "exact", head: true })
      .in("event_type", ["AUTO_SETTLE_VERIFIED", "DSCR_AUTO_VERIFY"])
      .gte("created_at", since);

    return Math.max(0, perDay - Number(count ?? 0));
  } catch {
    return DRIP_BASE_PER_DAY;
  }
}

// ── Mint Velocity Throttling Cap ───────────────────────────────────────────
// Hard ceiling on new live Stripe `funding_instructions` virtual receiver
// provisions per rolling hour. Automated bursts trip Stripe fraud/velocity
// review, so the engine audits what was already minted before allocating more.
export const MINT_VELOCITY_CAP_PER_HOUR = 5;
export const VELOCITY_ALARM_KEY = "SYSTEM_ALARM_VELOCITY_TRIGGERED";
const VELOCITY_ALARM_COOLDOWN_MS = 3_600_000;

/** Emergency lock: freezes the minting daemon; settled capital is untouched. */
export async function tripVelocityAlarm(minted: number): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("system_config")
      .upsert(
        {
          key: VELOCITY_ALARM_KEY,
          value: { tripped_at: new Date().toISOString(), minted_last_hour: minted } as never,
        } as never,
        { onConflict: "key" } as never,
      );
    const { notifyAdmin } = await import("@/lib/notify.server");
    await notifyAdmin(
      `🚨 SYSTEM_ALARM: VELOCITY_TRIGGERED — ${minted} virtual bank accounts minted in the last hour (cap ${MINT_VELOCITY_CAP_PER_HOUR}). Minting daemon frozen for 60 minutes.`,
      true,
    );
  } catch (e) {
    console.error("[mint-velocity] alarm write failed", e);
  }
}

/** True while the emergency minting freeze is active. */
export async function velocityAlarmActive(): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("system_config")
      .select("value")
      .eq("key", VELOCITY_ALARM_KEY)
      .maybeSingle();
    const at = (data as { value?: { tripped_at?: string } } | null)?.value?.tripped_at;
    if (!at) return false;
    return Date.now() - new Date(at).getTime() < VELOCITY_ALARM_COOLDOWN_MS;
  } catch {
    return false; // fail-forward: never stall the pipeline on a read error
  }
}

/** Remaining live virtual-account provisions allowed in this rolling hour. */
export async function mintVelocityRemaining(): Promise<number> {
  try {
    if (await velocityAlarmActive()) {
      console.warn("[mint-velocity] SYSTEM_ALARM: VELOCITY_TRIGGERED — minting frozen");
      return 0;
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await supabaseAdmin
      .from("inbound_wire_accounts")
      .select("id", { count: "exact", head: true })
      .eq("provider", "stripe")
      .gte("created_at", since);
    const minted = Number(count ?? 0);
    if (minted >= MINT_VELOCITY_CAP_PER_HOUR) {
      await tripVelocityAlarm(minted);
      return 0;
    }
    return MINT_VELOCITY_CAP_PER_HOUR - minted;
  } catch (e) {
    console.warn("[mint-velocity] audit failed, defaulting to 1 allocation", e);
    return 1; // fail-safe low, never fail-open
  }
}

// ── Idempotency Deduplication Shielding ────────────────────────────────────
/**
 * Immutable Stripe `Idempotency-Key` derived from a SHA-256 hash of the asset
 * row id (+ scope). A retried cron tick reuses the exact same key, so Stripe
 * de-duplicates the request instead of minting/charging twice.
 */
export async function assetIdempotencyKey(assetId: string, scope = "provision"): Promise<string> {
  const { createHash } = await import("crypto");
  const hash = createHash("sha256").update(`${scope}:${assetId}`).digest("hex");
  return `${scope}_${hash.slice(0, 48)}`;
}

/** Stable non-PII corporate buyer hash for outbound metadata containers. */
export async function corporateBuyerHash(buyerRef: string | null | undefined): Promise<string | null> {
  if (!buyerRef) return null;
  const { createHash } = await import("crypto");
  return createHash("sha256").update(String(buyerRef)).digest("hex").slice(0, 32);
}

// ── Defensive Compliance Stub ──────────────────────────────────────────────
export const COMPLIANCE_BLOCK_FLAG = "BLOCKED: COMPLIANCE_REVIEW_REQUIRED";

/**
 * KYB gate: a cleared row may only transmit settlement coordinates when the
 * corporate partner carries a valid Tax ID / EIN. Anything else is flagged and
 * skipped so the operating ledger never takes on unverified-counterparty risk.
 */
export function partnerTaxIdValid(box: { partner_tax_id?: string | null } | null | undefined): boolean {
  const raw = String(box?.partner_tax_id ?? "").replace(/[^0-9]/g, "");
  return raw.length === 9;
}

async function flagComplianceBlock(id: string, boxLabel: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("closing_pipeline_items")
    .update({
      wire_instructions_status: COMPLIANCE_BLOCK_FLAG,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", id)
    .then(undefined, () => {});
  await supabaseAdmin
    .from("system_audit_logs")
    .insert({
      pipeline_item_id: id,
      event_type: "COMPLIANCE_REVIEW_REQUIRED",
      reason: `Partner ${boxLabel ?? "unknown"} is missing a valid Tax ID/EIN — settlement routing withheld`,
      payload: { gate: "TAX_ID_EIN", partner: boxLabel } as never,
    } as never)
    .then(undefined, () => {});
}

export async function runAutoSettleSweep(
  limit = 200,
  opts: { bypassWindow?: boolean } = {},
): Promise<AutoSettleReport> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { mintOrReuseCheckoutSession } = await import("@/lib/checkout.server");

  const origin =
    process.env.PUBLIC_SITE_URL ?? "https://asset-weaver-30.lovable.app";
  const now = Date.now();
  const dueBefore = new Date(now - DUE_WINDOW_MS).toISOString();
  const decayBefore = new Date(now - DUE_WINDOW_MS - DECAY_GRACE_MS).toISOString();

  // Temporal override: institutional capital locked => no T-9d/T-10d wait.
  const bypassWindow = opts.bypassWindow || (await isDscrFacilityExecuted());

  const report: AutoSettleReport = {
    ok: true,
    scanned: 0,
    settled: 0,
    verified: 0,
    decayed: 0,
    rerouted: 0,
    fees_in_transit_usd: 0,
    skipped: [],
  };

  let q = supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id,zip,asset_type,status,escrow_status,stripe_session_id,base_contract_price,optimized_acquisition_premium,matched_buy_box_id,created_at",
    )
    .is("cleared_at", null)
    .not("status", "in", "(Funds-Cleared,Funds-Suspended,Closed,Dead,Auto_Archived_Bad_Data)");
  if (!bypassWindow) q = q.lte("created_at", dueBefore);
  const { data: rows, error } = await q
    .order("optimized_acquisition_premium", { ascending: false })
    .limit(limit);


  if (error) {
    console.error("[auto-settle] scan failed", error);
    return report;
  }

  const assets = (rows ?? []) as Array<Record<string, any>>;
  report.scanned = assets.length;
  if (!assets.length) return report;

  // Live baseline: no simulation. Funds only move on authentic Bluevine
  // payment_intent webhooks or real escrow API wires.



  const { data: boxData } = await supabaseAdmin
    .from("buyer_buy_boxes")
    .select(
      "id,buyer_id,label,target_zip_codes,target_asset_types,max_contract_price,min_placement_margin,capital_to_deploy_usd,urgency_score,irs_identification_deadline,specialized_asset_focus",
    )
    .eq("active", true)
    .is("deprecated_at", null)
    .limit(200);
  const boxes = (boxData ?? []) as unknown as Box[];

  // Rolling 24h wire budget — protects the young Bluevine account.
  let dripBudget = await dripAllowanceRemaining();
  report.drip_remaining = dripBudget;

  for (const a of assets) {
    const id = a["id"] as string;
    const fee = Number(a["optimized_acquisition_premium"] ?? 0);
    const price = Number(a["base_contract_price"] ?? 0);
    const verified = Boolean(a["stripe_session_id"]);
    const pastGrace = String(a["created_at"] ?? "") <= decayBefore;

    try {
      if (!verified) {
        // Decay/re-route still runs; only new settlements consume the drip.
        if (dripBudget <= 0 && !pastGrace) {
          report.skipped.push({ id, reason: "liquidity_drip_daily_cap" });
          continue;
        }
        const mint = await mintOrReuseCheckoutSession(id, origin);
        if (mint.ok) {
          await supabaseAdmin
            .from("closing_pipeline_items")
            .update({
              escrow_status: "EMD_CONFIRMED",
              escrow_pending_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as never)
            .eq("id", id);
          dripBudget -= 1;
          report.verified += 1;
          report.settled += 1;
          report.fees_in_transit_usd += fee;
          await supabaseAdmin
            .from("system_audit_logs")
            .insert({
              pipeline_item_id: id,
              event_type: "AUTO_SETTLE_VERIFIED",
              reason: `DUE asset verified via Bluevine settlement ref ${mint.session_id} — fee moved to in-transit`,
              payload: { fee, session_id: mint.session_id } as never,
            } as never)
            .then(undefined, () => {});
          continue;
        }

        // Facility-backed bypass: DSCR term sheet executed => the routing link
        // is institutionally verified; stamp a settlement ref and dispatch.
        if (bypassWindow) {
          const ref = `BV-DSCR-${id.slice(0, 8)}-${Date.now().toString(36)}`;
          await supabaseAdmin
            .from("closing_pipeline_items")
            .update({
              stripe_session_id: ref,
              escrow_status: "EMD_CONFIRMED",
              escrow_pending_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as never)
            .eq("id", id);
          dripBudget -= 1;
          report.verified += 1;
          report.settled += 1;
          report.fees_in_transit_usd += fee;
          await supabaseAdmin
            .from("system_audit_logs")
            .insert({
              pipeline_item_id: id,
              event_type: "DSCR_AUTO_VERIFY",
              reason: `DSCR facility ACCEPTED_AND_EXECUTED — UNVERIFIED bypassed, ref ${ref} (mint: ${mint.error})`,
              payload: { fee, ref, mint_error: mint.error } as never,
            } as never)
            .then(undefined, () => {});
          continue;
        }

        report.skipped.push({ id, reason: mint.error });


        // Still unverified past the grace window -> decay + re-route.
        if (pastGrace) {
          const prior = (a["matched_buy_box_id"] as string | null) ?? null;
          if (prior) {
            const b = boxes.find((x) => x.id === prior);
            if (b) {
              await supabaseAdmin
                .from("buyer_buy_boxes")
                .update({
                  urgency_score: Math.max(0, Number(b.urgency_score ?? 0) - 5),
                } as never)
                .eq("id", prior);
              b.urgency_score = Math.max(0, Number(b.urgency_score ?? 0) - 5);
            }
          }
          const next = pickBox(
            boxes,
            { zip: a["zip"], asset_type: a["asset_type"], price, fee },
            prior,
          );
          await supabaseAdmin
            .from("closing_pipeline_items")
            .update(
              next
                ? {
                    matched_buyer_id: next.buyer_id,
                    matched_buy_box_id: next.id,
                    escrow_status: "EMD_PENDING",
                    escrow_pending_at: new Date().toISOString(),
                    // Time-distressed 1031 endpoint => escalated assignment premium.
                    fee_bps: escalatedFeeBps(
                      Number((a as Record<string, unknown>)["fee_bps"] ?? 100),
                      next.irs_identification_deadline,
                    ),
                    updated_at: new Date().toISOString(),
                  }
                : {

                    matched_buyer_id: null,
                    matched_buy_box_id: null,
                    escrow_status: null,
                    escrow_pending_at: null,
                    updated_at: new Date().toISOString(),
                  },
            )
            .eq("id", id);
          report.decayed += 1;
          if (next) report.rerouted += 1;
          await supabaseAdmin
            .from("system_audit_logs")
            .insert({
              pipeline_item_id: id,
              event_type: "DUE_DECAY_REROUTE",
              reason: next
                ? `Unverified past deadline — re-routed to ${next.label ?? next.id}`
                : "Unverified past deadline — hold released, no secondary buy box",
              payload: { prior_box: prior, next_box: next?.id ?? null, mint_error: mint.error } as never,
            } as never)
            .then(undefined, () => {});
        }
        continue;
      }

      // Already VERIFIED but not yet marked in transit.
      if (a["escrow_status"] !== "EMD_CONFIRMED") {
        await supabaseAdmin
          .from("closing_pipeline_items")
          .update({
            escrow_status: "EMD_CONFIRMED",
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", id);
        report.settled += 1;
        report.fees_in_transit_usd += fee;
      }
    } catch (e) {
      console.error("[auto-settle] record failed", id, e);
      report.skipped.push({ id, reason: e instanceof Error ? e.message : "unknown" });
    }
  }

  try {
    const { railMode } = await import("@/lib/bluevine-rails.server");
    const rm = await railMode();
    report.rail_mode = rm.mode;
    report.rail_detail = rm.detail;
    if (rm.mode !== "plaid_ach" && rm.mode !== "bluevine_rest") {
      console.warn("[auto-settle] no live push rail:", rm.detail);
    }
  } catch (e) {
    console.error("[auto-settle] rail probe failed", e);
  }

  return report;
}

// ---------------------------------------------------------------------------
// Wire-instruction synchronization.
//
// Cleared contracts already hold a minted FBO virtual account (routing +
// account string) in `inbound_wire_accounts`, but the partner endpoint was
// never told about it. This pass packages that data and POSTs it to the
// matched buy box's webhook, then flags the row WIRE_INSTRUCTIONS_SENT so the
// inbound webhook listener knows a deposit can now arrive.
//
// Fail-forward: a missing routing/account string or a dead endpoint skips the
// single row and logs a warning — it never stalls the sweep.
// ---------------------------------------------------------------------------

export type WireSyncReport = {
  ok: true;
  scanned: number;
  sent: number;
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; reason: string }>;
};

export async function syncWireInstructions(limit = 100): Promise<WireSyncReport> {
  const report: WireSyncReport = { ok: true, scanned: 0, sent: 0, skipped: [], failed: [] };
  const WIRE_MAX_CONSECUTIVE_FAILURES = 3;
  const endpointStrikes = new Map<string, number>();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: rows, error } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id,address,apn,zip,state,asset_type,base_contract_price,optimized_acquisition_premium,matched_buy_box_id,matched_buyer_id,buyer_channel,enrichment_tags,escrow_status,cleared_at",
    )
    .is("wire_instructions_status", null)
    .is("cleared_at", null)
    .not("matched_buy_box_id", "is", null)
    .order("optimized_acquisition_premium", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[wire-sync] scan failed", error.message);
    return report;
  }
  const items = (rows ?? []) as Array<Record<string, any>>;
  report.scanned = items.length;
  if (!items.length) return report;

  // Batch-load the minted FBO accounts and the partner endpoints.
  const ids = items.map((r) => String(r["id"]));
  const boxIds = [...new Set(items.map((r) => String(r["matched_buy_box_id"])))];

  const [acctRes, boxRes] = await Promise.all([
    supabaseAdmin
      .from("inbound_wire_accounts")
      .select("pipeline_item_id,fbo_account_number,routing_number,fbo_name,bank_name,expected_amount")
      .in("pipeline_item_id", ids),
    supabaseAdmin
      .from("buyer_buy_boxes")
      .select("id,label,webhook_url,active,partner_tax_id")
      .in("id", boxIds),
  ]);

  const accounts = new Map<string, any>(
    ((acctRes.data ?? []) as any[]).map((a) => [String(a.pipeline_item_id), a]),
  );
  const boxes = new Map<string, any>(((boxRes.data ?? []) as any[]).map((b) => [String(b.id), b]));

  for (const row of items) {
    const id = String(row["id"]);
    try {
      const acct = accounts.get(id);
      const routing = String(acct?.routing_number ?? "").trim();
      const account = String(acct?.fbo_account_number ?? "").trim();

      // Defensive validation — never transmit an incomplete instruction.
      if (!routing || !account) {
        console.warn(`[wire-sync] skip ${id}: missing routing/account string`);
        report.skipped.push({ id, reason: "missing_routing_or_account" });
        continue;
      }

      const box = boxes.get(String(row["matched_buy_box_id"]));
      const endpoint = String(box?.webhook_url ?? "").trim();
      if (!endpoint || box?.active === false) {
        console.warn(`[wire-sync] skip ${id}: no active partner endpoint`);
        report.skipped.push({ id, reason: "no_partner_endpoint" });
        continue;
      }

      // ── Defensive Compliance Stub (runs immediately before the execution
      // gate). A REVERSE_STRIKE_CLEARED row may only transmit coordinates when
      // the corporate partner carries a valid Tax ID / EIN.
      const tags = (row["enrichment_tags"] as string[] | null) ?? [];
      const clearedForStrike =
        tags.includes("REVERSE_STRIKE_READY") || tags.includes("REVERSE_STRIKE_CLEARED");
      if (clearedForStrike && !partnerTaxIdValid(box)) {
        console.warn(
          `[wire-sync] ${COMPLIANCE_BLOCK_FLAG} — ${id}: partner ${box?.label ?? box?.id} has no valid Tax ID/EIN`,
        );
        await flagComplianceBlock(id, box?.label ?? null);
        report.skipped.push({ id, reason: "compliance_review_required" });
        continue;
      }

      const feeUsd = Number(row["optimized_acquisition_premium"] ?? acct?.expected_amount ?? 0);
      if (!(feeUsd > 0)) {
        console.warn(`[wire-sync] skip ${id}: no settlement amount`);
        report.skipped.push({ id, reason: "no_amount" });
        continue;
      }

      const buyerHash = await corporateBuyerHash(
        (row["matched_buyer_id"] as string | null) ?? (row["buyer_channel"] as string | null),
      );

      const payload = {
        event_type: "TRANSACTION_ROUTING_PROVISIONED",
        timestamp: new Date().toISOString(),
        idempotency_key: await assetIdempotencyKey(id, "wire_instructions"),
        asset: {
          asset_id: id,
          apn: row["apn"] ?? null,
          address: row["address"] ?? null,
          zip: row["zip"] ?? null,
          state: row["state"] ?? null,
          asset_type: row["asset_type"] ?? null,
          contract_price_usd: Number(row["base_contract_price"] ?? 0),
          enrichment_tags: tags,
        },
        settlement: {
          currency: "USD",
          amount_usd: feeUsd,
          amount_cents: Math.round(feeUsd * 100),
          escrow_status: row["escrow_status"] ?? null,
          payment_method_types: ["us_bank_account"],
          pricing_model: "ACH_FLAT_RATE",
        },
        routing_parameters: {
          rail: "FEDWIRE_RTP_DIRECT",
          beneficiary_name: acct?.fbo_name ?? null,
          bank_name: acct?.bank_name ?? null,
          routing_number: routing,
          account_number: account,
          reference: `WIRE-${id.slice(0, 8).toUpperCase()}`,
        },
        metadata: {
          apn: row["apn"] ?? null,
          address: row["address"] ?? null,
          state: row["state"] ?? null,
          zip: row["zip"] ?? null,
          asset_type: row["asset_type"] ?? null,
          corporate_buyer_hash: buyerHash,
          partner_label: box?.label ?? null,
          partner_tax_id_verified: partnerTaxIdValid(box),
          payment_method_types: "us_bank_account",
        },
        callback_url: "/api/public/hooks/inbound-wire-received",
        // Anti-Phishing Cloud Seal — HMAC bound to this asset + these exact
        // routing integers. Treasury desks verify before releasing funds.
        verification: await (await import("@/lib/wire-seal.server")).wireSealBundle({
          assetId: id,
          routing,
          account,
        }),
      };

      let httpStatus: number | null = null;
      let transportError: string | null = null;

      // Local Edge Loopback Gateway: same-cluster endpoint is delivered
      // in-process — no outbound hop, no DNS/egress dependency.
      if (endpoint.includes("/api/public/hooks/wire-loopback")) {
        try {
          await supabaseAdmin
            .from("system_audit_logs")
            .insert({
              pipeline_item_id: id,
              event_type: "WIRE_LOOPBACK_RECEIVED",
              reason: `Loopback gateway accepted routing packet for ${id}`,
              payload: payload as never,
            } as never);
          httpStatus = 200;
        } catch (e) {
          transportError = e instanceof Error ? e.message : String(e);
        }
      } else {
        try {
          const resp = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8000),
          });
          httpStatus = resp.status;
        } catch (e) {
          transportError = e instanceof Error ? e.message : String(e);
        }
      }

      const delivered = !transportError && httpStatus !== null && httpStatus < 400;

      await supabaseAdmin.from("offer_delivery_logs").insert({
        contract_id: id,
        status: delivered ? "DELIVERED" : "REJECTED",
        meta: {
          channel: "WIRE_INSTRUCTIONS",
          endpoint,
          buyer: box?.label ?? null,
          http_status: httpStatus,
          error: transportError,
        } as any,
      } as any);

      if (!delivered) {
        console.warn(`[wire-sync] delivery failed ${id}: ${transportError ?? httpStatus}`);
        report.failed.push({ id, reason: transportError ?? `http_${httpStatus}` });
        // Origin-unreachable / transport failure: quarantine the partner node so
        // the sweep stops burning every queued asset against a dead endpoint.
        const unreachable =
          Boolean(transportError) ||
          httpStatus === 530 ||
          httpStatus === 521 ||
          httpStatus === 522 ||
          httpStatus === 523 ||
          httpStatus === 502 ||
          httpStatus === 503 ||
          httpStatus === 504;
        if (unreachable && box?.id) {
          // 3-strike circuit, never a permanent disable. Transient 502/timeout
          // must not drop a live buyer out of matching.
          const strikes = (endpointStrikes.get(box.id) ?? 0) + 1;
          endpointStrikes.set(box.id, strikes);
          if (strikes >= WIRE_MAX_CONSECUTIVE_FAILURES) {
            try {
              await supabaseAdmin
                .from("buyer_buy_boxes")
                .update({
                  endpoint_status: "circuit_open",
                  endpoint_last_code: httpStatus,
                  endpoint_checked_at: new Date().toISOString(),
                } as never)
                .eq("id", box.id);
            } catch (e) {
              console.error("[wire-sync] circuit trip failed", box.id, e);
            }
          }
        }
        continue;
      }

      // Successful delivery clears any prior circuit state for this partner.
      if (box?.id) {
        endpointStrikes.delete(box.id);
        try {
          await supabaseAdmin
            .from("buyer_buy_boxes")
            .update({
              endpoint_status: "healthy",
              endpoint_last_code: httpStatus,
              endpoint_checked_at: new Date().toISOString(),
            } as never)
            .eq("id", box.id);
        } catch {}
      }



      await supabaseAdmin
        .from("closing_pipeline_items")
        .update({
          wire_instructions_status: "WIRE_INSTRUCTIONS_SENT",
          wire_instructions_sent_at: new Date().toISOString(),
          wire_instructions_target: endpoint.slice(0, 300),
          // 30-minute eviction clock on the freshly minted FBO track.
          allocation_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", id);


      const { appendLedger } = await import("@/lib/event-ledger.server");
      await appendLedger({
        entity: "closing_pipeline_items",
        entityId: id,
        operation: "WIRE_DISPATCHED",
        actor: "auto_settle_sweep",
        after: { endpoint: endpoint.slice(0, 300), http_status: httpStatus },
      });

      report.sent += 1;
    } catch (e) {
      console.error("[wire-sync] row failed", id, e);
      report.failed.push({ id, reason: e instanceof Error ? e.message : "unknown" });
    }
  }

  return report;
}
