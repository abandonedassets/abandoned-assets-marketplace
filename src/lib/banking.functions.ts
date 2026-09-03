import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Masked Bluevine payout coordinates — the single active settlement destination. */
export const getPayoutDestination = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { wireConfig, BENEFICIARY_NAME } = await import("@/lib/bluevine.server");
    const cfg = wireConfig();
    return {
      rail: "fedwire" as const,
      processor: "bluevine" as const,
      beneficiary: BENEFICIARY_NAME,
      bank: cfg.bank,
      bank_address: cfg.address,
      routing_prefix: cfg.routing ? String(cfg.routing).slice(0, 3) : null,
      account_last4: cfg.account ? String(cfg.account).slice(-4) : null,
      configured: Boolean(cfg.routing && cfg.account),
    };
  });

/**
 * Live production readiness for the money path: are we on real secrets and
 * real bank listeners, or on instruction-only / mock handlers?
 * Booleans and masked values only — never raw secrets.
 */
export const getRailDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { liveRailStatus } = await import("@/lib/live-rails.server");
    const { bluevineStatus } = await import("@/lib/bluevine-rails.server");
    const { plaidStatus } = await import("@/lib/plaid.server");
    const { beneficiaryAccounts } = await import("@/lib/beneficiary-payout.server");

    const rails = liveRailStatus();
    const bv = await bluevineStatus();
    const plaid = await plaidStatus().catch(() => null);

    const webhooks = {
      bluevine_settlement_secret: Boolean(
        process.env["BLUEVINE_WEBHOOK_SECRET"] ?? process.env["SETTLEMENT_WEBHOOK_SECRET"],
      ),
      plaid_webhook_bound: Boolean(process.env["PLAID_WEBHOOK_URL"] ?? process.env["PUBLIC_SITE_URL"]),
      m2m_signing_secret: Boolean(process.env["M2M_SIGNING_SECRET"]),
    };

    const beneficiaries = beneficiaryAccounts();

    const live_transfer_ready =
      rails.live &&
      (Boolean((plaid as any)?.linked) || bv.coordinates_ready) &&
      webhooks.bluevine_settlement_secret;

    return {
      live_transfer_ready,
      mode: live_transfer_ready ? ("PRODUCTION" as const) : ("INSTRUCTION_ONLY" as const),
      rails,
      bluevine: bv,
      plaid,
      webhooks,
      beneficiaries,
      checked_at: new Date().toISOString(),
    };
  });

/** Internal beneficiary liability — credit balances owed out of primary intake. */
export const getBeneficiaryLiability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("internal_beneficiary_allocations" as any)
      .select("beneficiary_key,beneficiary_label,amount_usd,status,created_at")
      .order("created_at", { ascending: false })
      .limit(2000);

    const rows = (data ?? []) as any[];
    const byKey = new Map<string, { key: string; label: string; accrued_usd: number; settled_usd: number; count: number }>();
    for (const r of rows) {
      const k = String(r.beneficiary_key);
      const e =
        byKey.get(k) ?? { key: k, label: String(r.beneficiary_label ?? k), accrued_usd: 0, settled_usd: 0, count: 0 };
      const amt = Number(r.amount_usd ?? 0) || 0;
      if (r.status === "settled") e.settled_usd += amt;
      else e.accrued_usd += amt;
      e.count += 1;
      byKey.set(k, e);
    }
    const balances = ["DAUGHTER", "JACQUITA", "PRIMARY"].map(
      (k) => byKey.get(k) ?? { key: k, label: k, accrued_usd: 0, settled_usd: 0, count: 0 },
    );
    return {
      balances,
      total_outstanding_usd: balances.reduce((s, b) => s + b.accrued_usd, 0),
      allocation_count: rows.length,
      checked_at: new Date().toISOString(),
    };
  });

/** Masked Bluevine REST facility posture (never returns the raw key). */
export const getBluevineConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as any);
    const { bluevineRestStatus } = await import("@/lib/bluevine-config.server");
    return await bluevineRestStatus();
  });

/** Save Bluevine REST credentials and immediately probe authentication. */
export const saveBluevineConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { base: string; key: string }) => d)
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as any);
    if (!data?.base?.trim() || !data?.key?.trim()) {
      return { ok: false as const, error: "base_and_key_required" };
    }
    if (!/^https:\/\//i.test(data.base.trim())) {
      return { ok: false as const, error: "base_must_be_https" };
    }
    const { saveBluevineRest, pingBluevine, bluevineRestStatus } = await import(
      "@/lib/bluevine-config.server"
    );
    const saved = await saveBluevineRest(data.base, data.key);
    if (!saved.ok) return { ok: false as const, error: saved.error };
    const ping = await pingBluevine();
    // Event-driven: credentials verified -> try to lift the block immediately.
    const { attemptAutoRelease } = await import("@/lib/auto-release.server");
    const release = await attemptAutoRelease("bluevine_credentials_saved");
    return { ok: true as const, ping, status: await bluevineRestStatus(), release };
  });

/** Live authentication probe against Bluevine. */
export const testBluevineConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as any);
    const { pingBluevine } = await import("@/lib/bluevine-config.server");
    return await pingBluevine();
  });

export const clearBluevineConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as any);
    const { clearBluevineRest } = await import("@/lib/bluevine-config.server");
    return await clearBluevineRest();
  });

/** Live autonomous-transit posture (read-only, safe to poll). */
export const getAutoReleaseStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as any);
    const { autoReleaseStatus } = await import("@/lib/auto-release.server");
    return await autoReleaseStatus();
  });

/**
 * Legacy manual trigger, retained for API compatibility. The same routine runs
 * automatically on credential save, Plaid link, and every cron cycle.
 */
export const liftExecutionBlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as any);
    const { attemptAutoRelease } = await import("@/lib/auto-release.server");
    return await attemptAutoRelease("manual");
  });

/** Masked multi-recipient payout profiles (split destinations). */
export const getRecipientProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as any);
    const { loadRecipientProfiles, maskProfile } = await import("@/lib/recipient-profiles.server");
    const profiles = (await loadRecipientProfiles()).map(maskProfile);
    return {
      profiles,
      total_allocated_pct: profiles.reduce((s, p) => s + (p.is_active ? p.allocation_pct : 0), 0),
      checked_at: new Date().toISOString(),
    };
  });

/** Upsert a recipient payout profile (admin only, coordinates never returned). */
export const saveRecipientProfile = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      recipient_key: string;
      display_name?: string;
      bank_name?: string;
      routing_number?: string;
      account_number?: string;
      allocation_pct?: number;
      flat_amount_usd?: number;
      is_active?: boolean;
    }) => d,
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("@/lib/require-admin");
    await requireAdmin(context as any);
    const key = String(data?.recipient_key ?? "").trim().toUpperCase();
    if (!key) return { ok: false as const, error: "recipient_key_required" };
    const pct = Number(data.allocation_pct ?? 0) || 0;
    if (pct < 0 || pct > 100) return { ok: false as const, error: "allocation_pct_out_of_range" };
    if (data.routing_number && !/^\d{9}$/.test(String(data.routing_number).trim())) {
      return { ok: false as const, error: "routing_number_must_be_9_digits" };
    }
    if (data.account_number && !/^\d{4,17}$/.test(String(data.account_number).trim())) {
      return { ok: false as const, error: "invalid_account_number" };
    }

    const patch: Record<string, unknown> = {
      recipient_key: key,
      allocation_pct: pct,
      flat_amount_usd: Number(data.flat_amount_usd ?? 0) || 0,
      is_active: data.is_active !== false,
    };
    if (data.display_name?.trim()) patch["display_name"] = data.display_name.trim();
    if (data.bank_name?.trim()) patch["bank_name"] = data.bank_name.trim();
    if (data.routing_number?.trim()) patch["routing_number"] = data.routing_number.trim();
    if (data.account_number?.trim()) patch["account_number"] = data.account_number.trim();
    if (!patch["display_name"]) patch["display_name"] = key;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("payout_recipient_profiles" as any)
      .upsert(patch as any, { onConflict: "recipient_key" });
    if (error) return { ok: false as const, error: error.message };

    const { loadRecipientProfiles, maskProfile } = await import("@/lib/recipient-profiles.server");
    return { ok: true as const, profiles: (await loadRecipientProfiles()).map(maskProfile) };
  });
