// Autonomous execution-block release.
// No human click: whenever Plaid is linked AND Bluevine authenticates AND the
// live rails assert clean, the safety lock lifts itself and parked assets are
// pushed back into active transit. Fail-forward — never throws to the caller.

export type AutoReleaseResult = {
  ok: boolean;
  handshake: boolean;
  plaid_linked: boolean;
  bluevine_authenticated: boolean;
  rails_live: boolean;
  block_active: boolean;
  released: number;
  reason?: string;
  checked_at: string;
};

async function handshakeState() {
  const { getLinkedItem } = await import("@/lib/plaid.server");
  const { pingBluevine } = await import("@/lib/bluevine-config.server");
  const { liveRailStatus } = await import("@/lib/live-rails.server");

  const linked = Boolean(await getLinkedItem().catch(() => null));
  const ping = await pingBluevine().catch(() => ({ ok: false, detail: "probe_failed" }) as any);
  const rails = liveRailStatus();
  return {
    linked,
    authed: Boolean(ping?.ok),
    rails_live: rails.live,
    reason: rails.live ? (ping?.ok ? undefined : String(ping?.detail ?? "bluevine_unauthenticated")) : rails.reason,
  };
}

/** Read-only posture — safe to poll from the dashboard. */
export async function autoReleaseStatus(): Promise<AutoReleaseResult> {
  const s = await handshakeState();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("system_config")
    .select("value")
    .eq("key", "execution_block")
    .maybeSingle();
  const blockActive = Boolean((data as any)?.value?.active);
  return {
    ok: true,
    handshake: s.linked && s.authed && s.rails_live,
    plaid_linked: s.linked,
    bluevine_authenticated: s.authed,
    rails_live: s.rails_live,
    block_active: blockActive,
    released: 0,
    reason: s.reason,
    checked_at: new Date().toISOString(),
  };
}

/**
 * Idempotent auto-release. Called by the credential save path, the Plaid
 * exchange path, and the every-minute autonomous cycle worker.
 */
export async function attemptAutoRelease(trigger: string): Promise<AutoReleaseResult> {
  const now = new Date().toISOString();
  try {
    const s = await handshakeState();
    if (!(s.linked && s.authed && s.rails_live)) {
      return {
        ok: false,
        handshake: false,
        plaid_linked: s.linked,
        bluevine_authenticated: s.authed,
        rails_live: s.rails_live,
        block_active: true,
        released: 0,
        reason: s.reason ?? "handshake_incomplete",
        checked_at: now,
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("system_config")
      .upsert(
        { key: "execution_block", value: { active: false, released_by: trigger, at: now } as any, updated_at: now },
        { onConflict: "key" },
      );

    const { data: released } = await supabaseAdmin
      .from("closing_pipeline_items")
      .update({ status: "Webhook_Dispatched" } as never)
      .in("status", ["System-Hold", "Queued-For-Tomorrow"])
      .select("id");

    const count = (released ?? []).length;

    if (count > 0) {
      await supabaseAdmin.from("system_audit_logs").insert({
        reason: `auto_release:${trigger}`,
        event_type: "AUTONOMOUS_TRANSIT",
        payload: { released: count } as any,
      } as never);
    }

    return {
      ok: true,
      handshake: true,
      plaid_linked: true,
      bluevine_authenticated: true,
      rails_live: true,
      block_active: false,
      released: count,
      checked_at: now,
    };
  } catch (e) {
    return {
      ok: false,
      handshake: false,
      plaid_linked: false,
      bluevine_authenticated: false,
      rails_live: false,
      block_active: true,
      released: 0,
      reason: (e as Error).message,
      checked_at: now,
    };
  }
}
