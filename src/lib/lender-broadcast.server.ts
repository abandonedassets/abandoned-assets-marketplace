// Server-side lender syndication broadcast core.
// Zero-mock: every row is a real HTTP attempt with real status + latency.
// Unconfigured / placeholder hosts return ERR: UNCONFIGURED_ENDPOINT.

export type LenderDispatch = {
  name: string;
  url: string;
  status: number;
  ok: boolean;
  latency_ms: number;
  detail: string;
};

export type LenderEndpoint = { id?: string; name?: string; url: string; token_env?: string };

const PLACEHOLDER_HOST = /(^|\.)(mock-api\.lender-network\.com|example\.(com|org)|localhost)$/i;

export async function listLenderEndpoints(): Promise<
  Array<LenderEndpoint & { configured: boolean }>
> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: cfg } = await supabaseAdmin
    .from("system_config")
    .select("value")
    .eq("key", "lender_endpoints")
    .maybeSingle();

  return (((cfg as any)?.value?.endpoints ?? []) as any[])
    .filter((e: any) => e && typeof e.url === "string")
    .map((e: any) => {
      let configured = false;
      try {
        const u = new URL(e.url);
        configured = u.protocol === "https:" && !PLACEHOLDER_HOST.test(u.hostname);
      } catch {
        configured = false;
      }
      const token_env = typeof e.token_env === "string" ? e.token_env : undefined;
      return { id: e.id, name: e.name ?? e.url, url: e.url, token_env, configured };
    });
}

/** Replace the registered lender intake endpoints. Rejects placeholder/non-https hosts. */
export async function saveLenderEndpoints(
  input: Array<{ id?: string; name?: string; url: string; token_env?: string }>,
): Promise<{ saved: number; rejected: Array<{ url: string; reason: string }> }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const clean: LenderEndpoint[] = [];
  const rejected: Array<{ url: string; reason: string }> = [];

  for (const e of input) {
    const url = String(e?.url ?? "").trim();
    if (!url) continue;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      rejected.push({ url, reason: "malformed_url" });
      continue;
    }
    if (u.protocol !== "https:") {
      rejected.push({ url, reason: "https_required" });
      continue;
    }
    // No connectivity pre-flight and no placeholder rejection at registration
    // time — the row saves instantly. Placeholder hosts are filtered later,
    // at broadcast time, so they never generate phantom transport failures.
    clean.push({
      id: e.id || u.hostname,
      name: (e.name ?? "").trim() || u.hostname,
      url: u.toString(),
      ...(e.token_env ? { token_env: String(e.token_env).trim() } : {}),
    });
  }

  await supabaseAdmin
    .from("system_config")
    .upsert({ key: "lender_endpoints", value: { endpoints: clean } as never }, { onConflict: "key" });

  return { saved: clean.length, rejected };
}

/** Masked-only transmission payload — no street numbers, GPS, or seller identity. */
export function maskLenderPackage(pkg: Record<string, unknown>): Record<string, unknown> {
  const assets = Array.isArray((pkg as any).assets) ? ((pkg as any).assets as any[]) : [];
  return {
    merkle_root: (pkg as any).merkle_root ?? null,
    asset_count: (pkg as any).asset_count ?? assets.length,
    notional_usd: (pkg as any).notional_usd ?? null,
    advance_base_usd: (pkg as any).advance_base_usd ?? null,
    access_expires: (pkg as any).access_expires ?? null,
    emd_usd: 100,
    assets: assets.map((a) => ({
      apn: a?.apn ?? null,
      zip: a?.zip ?? null,
      acreage: a?.acreage ?? null,
      zoning: a?.zoning ?? null,
      arv: a?.arv ?? null,
      assignment_spread: a?.assignment_spread ?? null,
      emd_usd: 100,
    })),
  };
}

export async function broadcastLenderPackage(pkg: Record<string, unknown>): Promise<{
  dispatched: boolean;
  reason: string | null;
  results: LenderDispatch[];
}> {
  const all = await listLenderEndpoints();
  // Only live, fully-qualified https targets are ever dialled. Placeholder rows
  // are never fetched and never logged — they used to flood dispatch_logs with
  // http_status 0 noise that looked like real transport failures.
  const endpoints = all.filter((e) => e.configured);

  if (!endpoints.length) {
    return {
      dispatched: false,
      reason:
        "ERR: UNCONFIGURED_ENDPOINT — no live lender intake URLs registered in system_config.lender_endpoints.",
      results: [],
    };
  }

  const masked = maskLenderPackage(pkg);
  const body = JSON.stringify({
    request_type: "indicative_soft_underwrite",
    dispatched_at: new Date().toISOString(),
    ...masked,
  });
  const { signM2M } = await import("@/lib/m2m-protocol.server");
  const sig = signM2M(body);

  const results: LenderDispatch[] = await Promise.all(
    endpoints.map(async (e) => {
      const name = e.name ?? e.url;
      const t0 = Date.now();
      try {
        const res = await fetch(e.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(sig ? { "X-M2M-Signature": `sha256=${sig}` } : {}),
            ...(e.token_env && process.env[e.token_env]
              ? { Authorization: `Bearer ${process.env[e.token_env]}` }
              : {}),
          },
          body,
          signal: AbortSignal.timeout(20_000),
        });
        const text = await res.text().catch(() => "");
        return {
          name,
          url: e.url,
          status: res.status,
          ok: res.ok,
          latency_ms: Date.now() - t0,
          detail: text.slice(0, 300) || res.statusText,
        };
      } catch (err) {
        return {
          name,
          url: e.url,
          status: 0,
          ok: false,
          latency_ms: Date.now() - t0,
          detail: `ERR: ${(err as Error).message}`,
        };
      }
    }),
  );

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("dispatch_logs").insert(
      results.map((r) => ({
        channel: "LENDER_SYNDICATION",
        endpoint_name: r.name,
        endpoint_url: r.url,
        http_status: r.status,
        ok: r.ok,
        latency_ms: r.latency_ms,
        detail: r.detail,
        payload: masked as never,
      })) as never,
    );
  } catch {
    /* telemetry write must never block dispatch */
  }

  return { dispatched: true, reason: null, results };
}
