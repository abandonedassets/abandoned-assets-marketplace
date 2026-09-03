import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

export type ApiKeyRow = {
  id: string;
  label: string;
  key_prefix: string;
  rate_limit_per_minute: number;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  declared_buying_power_usd: number | null;
};

export const listApiKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ApiKeyRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("institutional_api_keys")
      .select(
        "id, label, key_prefix, rate_limit_per_minute, is_active, created_at, last_used_at, declared_buying_power_usd",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as any[]).map((r) => ({
      ...r,
      declared_buying_power_usd:
        r.declared_buying_power_usd != null
          ? Number(r.declared_buying_power_usd)
          : null,
    })) as ApiKeyRow[];
  });

export const setBuyingPower = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; declared_buying_power_usd: number | null }) => {
    if (!d.id) throw new Error("invalid_id");
    const v =
      d.declared_buying_power_usd == null
        ? null
        : Math.max(0, Math.floor(Number(d.declared_buying_power_usd)));
    return { id: d.id, declared_buying_power_usd: v };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("institutional_api_keys")
      .update({ declared_buying_power_usd: data.declared_buying_power_usd } as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { buyer_name: string; rate_limit_per_minute?: number }) => {
      const name = (d.buyer_name ?? "").trim();
      if (!name || name.length > 200) throw new Error("invalid_buyer_name");
      const rl = Math.min(
        Math.max(Math.floor(d.rate_limit_per_minute ?? 60), 1),
        10_000,
      );
      return { buyer_name: name, rate_limit_per_minute: rl };
    },
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { createHash, randomBytes } = await import("crypto");

    const raw = `sk_live_v1_${randomBytes(24).toString("hex")}`;
    const key_hash = createHash("sha256").update(raw).digest("hex");
    const key_prefix = raw.slice(0, 16);

    const { data: row, error } = await supabaseAdmin
      .from("institutional_api_keys")
      .insert({
        label: data.buyer_name,
        key_hash,
        key_prefix,
        rate_limit_per_minute: data.rate_limit_per_minute,
        is_active: true,
      })
      .select("id, label, created_at")
      .single();
    if (error) throw new Error(error.message);

    // Auto-promote any matching waitlist entry and fire telemetry.
    try {
      await supabaseAdmin
        .from("buyer_waitlist")
        .update({ status: "approved" } as any)
        .ilike("fund_name", data.buyer_name)
        .eq("status", "pending");
      const { notifyAdmin } = await import("@/lib/notify.server");
      await notifyAdmin(
        `🔑 LIQUIDITY EXPANDED: ${data.buyer_name} promoted to Tier 1. Key: ${key_prefix}…`,
      );
    } catch (e) {
      console.error("waitlist promote/notify failed", e);
    }

    return { id: row.id, label: row.label, raw_key: raw };
  });


export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d.id) throw new Error("invalid_id");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("institutional_api_keys")
      .update({ is_active: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type WaitlistRow = {
  id: string;
  fund_name: string;
  contact_email: string | null;
  target_zips: string[];
  aum_bracket: string | null;
  status: string;
  created_at: string;
};

export const listWaitlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({ context }): Promise<{ pending_count: number; rows: WaitlistRow[] }> => {
      await assertAdmin(context);
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      const { data, error } = await supabaseAdmin
        .from("buyer_waitlist")
        .select(
          "id, fund_name, contact_email, target_zips, aum_bracket, status, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as WaitlistRow[];
      return {
        pending_count: rows.filter((r) => r.status === "pending").length,
        rows,
      };
    },
  );

/* ── Counterparty governance funnel ─────────────────────────────────────────
   INVITED → PROVISIONED → UAT_VERIFIED → PRODUCTION_ENABLED → ACTIVE
   Makes the "$0" state legible: zeroes mean no counterparty has reached
   ACTIVE, not that the rails are broken. */

export const FUNNEL_STATES = [
  "INVITED",
  "PROVISIONED",
  "UAT_VERIFIED",
  "PRODUCTION_ENABLED",
  "ACTIVE",
] as const;
export type FunnelState = (typeof FUNNEL_STATES)[number];

export type CounterpartyRow = {
  id: string;
  label: string;
  key_prefix: string;
  is_active: boolean;
  sandbox: boolean | null;
  onboarding_state: FunnelState;
  require_asymmetric: boolean;
  has_public_key: boolean;
  uat_verified_at: string | null;
  production_enabled_at: string | null;
  first_intent_at: string | null;
  last_used_at: string | null;
};

export const listCounterparties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ rows: CounterpartyRow[]; counts: Record<string, number> }> => {
      await assertAdmin(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin
        .from("institutional_api_keys")
        .select(
          "id, label, key_prefix, is_active, sandbox, onboarding_state, require_asymmetric, ecdsa_public_key, uat_verified_at, production_enabled_at, first_intent_at, last_used_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      const rows = ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        label: r.label,
        key_prefix: r.key_prefix,
        is_active: r.is_active,
        sandbox: r.sandbox ?? null,
        onboarding_state: (r.onboarding_state ?? "INVITED") as FunnelState,
        require_asymmetric: Boolean(r.require_asymmetric),
        has_public_key: Boolean(r.ecdsa_public_key),
        uat_verified_at: r.uat_verified_at,
        production_enabled_at: r.production_enabled_at,
        first_intent_at: r.first_intent_at,
        last_used_at: r.last_used_at,
      })) as CounterpartyRow[];
      const counts: Record<string, number> = Object.fromEntries(
        FUNNEL_STATES.map((s) => [s, 0]),
      );
      for (const r of rows) counts[r.onboarding_state] = (counts[r.onboarding_state] ?? 0) + 1;
      return { rows, counts };
    },
  );

export const setCounterpartyState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; state: string }) => {
    if (!d.id) throw new Error("invalid_id");
    if (!(FUNNEL_STATES as readonly string[]).includes(d.state)) throw new Error("invalid_state");
    return { id: d.id, state: d.state as FunnelState };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { onboarding_state: data.state };
    if (data.state === "UAT_VERIFIED") patch["uat_verified_at"] = now;
    if (data.state === "PRODUCTION_ENABLED") patch["production_enabled_at"] = now;
    const { error } = await supabaseAdmin
      .from("institutional_api_keys")
      .update(patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Registers a counterparty's ECDSA/RSA public key (PEM) for envelope signing. */
export const setCounterpartyPublicKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; pem: string | null; require_asymmetric?: boolean }) => {
    if (!d.id) throw new Error("invalid_id");
    const pem = (d.pem ?? "").trim();
    if (pem && !pem.startsWith("-----BEGIN PUBLIC KEY-----")) throw new Error("invalid_pem");
    if (pem.length > 4000) throw new Error("pem_too_large");
    return { id: d.id, pem: pem || null, require_asymmetric: Boolean(d.require_asymmetric) };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("institutional_api_keys")
      .update({
        ecdsa_public_key: data.pem,
        require_asymmetric: data.pem ? data.require_asymmetric : false,
      } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** One-time operator reveal of a counterparty's HMAC signing secret. */
export const revealCounterpartySecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d.id) throw new Error("invalid_id");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("institutional_api_keys")
      .select("label, key_prefix, hmac_secret, sandbox")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("not_found");
    const r = row as Record<string, any>;
    try {
      await supabaseAdmin.from("system_audit_logs").insert({
        event_type: "COUNTERPARTY_SECRET_REVEALED",
        reason: `Operator revealed signing secret for ${r["key_prefix"]}`,
        payload: { api_key_id: data.id } as any,
      } as never);
    } catch {}
    return {
      label: String(r["label"]),
      key_id: String(r["key_prefix"]),
      hmac_secret: (r["hmac_secret"] as string | null) ?? null,
      sandbox: Boolean(r["sandbox"]),
    };
  });
