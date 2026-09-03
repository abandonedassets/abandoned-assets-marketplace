// Live endpoint telemetry: every probe is a real network/DB call, no simulation.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Probe = {
  name: string;
  target: string;
  mode: "LIVE" | "CONFIG";
  ok: boolean;
  status: number;
  latency_ms: number;
  detail: string;
};

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

async function probe(
  name: string,
  target: string,
  run: () => Promise<{ ok: boolean; status: number; detail: string }>,
): Promise<Probe> {
  const t0 = Date.now();
  try {
    const r = await run();
    return { name, target, mode: "LIVE", ...r, latency_ms: Date.now() - t0 };
  } catch (e) {
    return {
      name,
      target,
      mode: "LIVE",
      ok: false,
      status: 0,
      latency_ms: Date.now() - t0,
      detail: (e as Error).message,
    };
  }
}

async function httpProbe(name: string, url: string, init: RequestInit): Promise<Probe> {
  return probe(name, url, async () => {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, detail: text.slice(0, 300) || res.statusText };
  });
}

export const runSystemDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ran_at: string; probes: Probe[] }> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const origin = process.env["PUBLIC_SITE_URL"] ?? "https://asset-weaver-30.lovable.app";

    const { data: cfgRows } = await supabaseAdmin
      .from("system_config")
      .select("key,value")
      .in("key", ["ledger_webhook_url", "lender_endpoints"]);
    const cfg = new Map((cfgRows ?? []).map((r: any) => [r.key, r.value]));
    const sheetUrl =
      (cfg.get("ledger_webhook_url") as any)?.url ??
      (typeof cfg.get("ledger_webhook_url") === "string" ? cfg.get("ledger_webhook_url") : null);

    const probes: Probe[] = [];

    probes.push(
      await probe("Database (closing_pipeline_items)", "supabase:postgrest", async () => {
        const { count, error } = await supabaseAdmin
          .from("closing_pipeline_items")
          .select("id", { count: "exact", head: true })
          .is("cleared_at", null);
        if (error) return { ok: false, status: 500, detail: error.message };
        return { ok: true, status: 200, detail: `${count ?? 0} open positions` };
      }),
    );

    if (sheetUrl) {
      probes.push(
        await httpProbe("Google Sheet ledger webhook", sheetUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ event: "diagnostics.ping", items: [] }),
          redirect: "follow",
        }),
      );
    } else {
      probes.push({
        name: "Google Sheet ledger webhook",
        target: "unconfigured",
        mode: "CONFIG",
        ok: false,
        status: 0,
        latency_ms: 0,
        detail: "No ledger_webhook_url in system_config — sync will always fail",
      });
    }

    probes.push(
      await httpProbe("Settlement state-runner hook", `${origin}/api/public/hooks/auto-settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: true, limit: 1 }),
      }),
    );

    probes.push(
      await httpProbe("Covenant / risk engine", `${origin}/api/public/hooks/covenant-engine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: true }),
      }),
    );

    const secretChecks: Array<[string, string]> = [
      ["Plaid client id", "PLAID_CLIENT_ID"],
      ["Plaid secret", "PLAID_SECRET"],
      ["M2M signing secret", "M2M_SHARED_SECRET"],
    ];
    for (const [name, key] of secretChecks) {
      const present = Boolean(process.env[key]);
      probes.push({
        name,
        target: key,
        mode: "CONFIG",
        ok: present,
        status: present ? 200 : 424,
        latency_ms: 0,
        detail: present ? "configured" : "MISSING — dependent calls will fail",
      });
    }

    const endpoints = (cfg.get("lender_endpoints") as any)?.endpoints;
    probes.push({
      name: "Lender intake endpoints",
      target: "system_config.lender_endpoints",
      mode: "CONFIG",
      ok: Array.isArray(endpoints) && endpoints.length > 0,
      status: Array.isArray(endpoints) && endpoints.length > 0 ? 200 : 424,
      latency_ms: 0,
      detail: Array.isArray(endpoints) && endpoints.length
        ? `${endpoints.length} endpoint(s) registered`
        : "No live lender URLs registered — broadcast is indicative only, nothing leaves the app",
    });

    return { ran_at: new Date().toISOString(), probes };
  });

/** Real lender broadcast (manual override of the autonomous cycle worker). */
export const broadcastToLenders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d?: { package?: Record<string, unknown> }) => ({ package: d?.package ?? {} }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { broadcastLenderPackage } = await import("@/lib/lender-broadcast.server");
    return broadcastLenderPackage(data.package);
  });

/** Registered lender intake endpoints (real config, no mock rows). */
export const getLenderEndpoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { listLenderEndpoints } = await import("@/lib/lender-broadcast.server");
    return listLenderEndpoints();
  });

/** Register / replace live lender intake endpoints. Placeholder hosts are rejected. */
export const setLenderEndpoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { endpoints?: Array<{ id?: string; name?: string; url: string; token_env?: string }> }) => ({
    endpoints: Array.isArray(d?.endpoints) ? d.endpoints.slice(0, 25) : [],
  }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { saveLenderEndpoints } = await import("@/lib/lender-broadcast.server");
    return saveLenderEndpoints(data.endpoints);
  });
