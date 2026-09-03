// Stage 2 → Stage 3 chain runner. Underwrites freshly ingested rows, then
// dispatches every priced asset to buyers with its dedicated FBO wire
// coordinates. Every hop is retried with exponential backoff; final failures
// are logged to system_alerts. Never throws.

export type ChainResult = {
  underwrite: unknown;
  dispatch: unknown;
  fbo: unknown;
  closing?: unknown;
};

function baseUrl(override?: string): string {
  // Prefer the native host the request actually arrived on: canonical-domain
  // rewrites on the public hostname would 307 these internal hops into a dead end.
  return override || process.env["PUBLIC_APP_URL"] || "https://asset-weaver-30.lovable.app";
}

async function post(path: string, body: Record<string, unknown>, origin?: string) {
  const res = await fetch(`${baseUrl(origin)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return await res.json().catch(() => ({}));
}

export async function runPipelineChain(opts?: {
  underwriteLimit?: number;
  dispatchLimit?: number;
  reason?: string;
  baseUrl?: string;
}): Promise<ChainResult> {
  const { withRetry } = await import("@/lib/retry.server");
  const out: ChainResult = { underwrite: null, dispatch: null, fbo: null };

  // Stage 2 — algorithmic underwriting (NOI / cap rate / MAO / assignment fee)
  const uw = await withRetry(
    () =>
      post(
        "/api/public/cron/auto-underwrite",
        { limit: opts?.underwriteLimit ?? 50 },
        opts?.baseUrl,
      ),
    { label: "auto-underwrite", metadata: { reason: opts?.reason ?? "chain" } },
  );
  out.underwrite = uw.ok ? uw.value : { ok: false, error: uw.error };


  // Stage 3a — mint FBO virtual accounts for everything awaiting buyer funds
  const fbo = await withRetry(
    async () => {
      const { provisionOpenDeals } = await import("@/lib/fbo.server");
      return await provisionOpenDeals();
    },
    { label: "fbo-provision", metadata: { reason: opts?.reason ?? "chain" } },
  );
  out.fbo = fbo.ok ? fbo.value : { ok: false, error: fbo.error };

  // Stage 3b — syndicate deal tape + wire coordinates to institutional buyers
  const dispatch = await withRetry(
    () =>
      post("/api/public/hooks/dispatch", { limit: opts?.dispatchLimit ?? 25 }, opts?.baseUrl),
    { label: "buyer-dispatch", metadata: { reason: opts?.reason ?? "chain" } },
  );
  out.dispatch = dispatch.ok ? dispatch.value : { ok: false, error: dispatch.error };

  return out;
}

/**
 * Deal Trigger fan-out — all three legs run in parallel and independently.
 * A failed leg is logged and never blocks the others (fail-forward).
 *
 *   Deal Trigger ──> buildClosingBundle (HUD + contracts + escrow)
 *                ├──> orderTitle (Qualia/title API order)
 *                └──> dispatchClosingEnvelope (e-sign)
 */
export async function runClosingAutomation(
  dealId: string,
  trigger: "PRE_BINDING_MPC" | "SIGN3_EMD_LOCK" | "MANUAL" = "MANUAL",
): Promise<{ deal_id: string; bundle: unknown; title: unknown; esign: unknown }> {
  const { withRetry } = await import("@/lib/retry.server");

  const legs = await Promise.allSettled([
    withRetry(
      async () => {
        const { buildClosingBundle } = await import("@/lib/closing-docs.server");
        return await buildClosingBundle(dealId);
      },
      { label: "closing-bundle", metadata: { dealId } },
    ),
    withRetry(
      async () => {
        const { orderTitle } = await import("@/lib/title-order.server");
        return await orderTitle(dealId, trigger);
      },
      { label: "title-order", metadata: { dealId } },
    ),
    withRetry(
      async () => {
        const { dispatchClosingEnvelope } = await import("@/lib/esign.server");
        return await dispatchClosingEnvelope({ dealId });
      },
      { label: "esign-envelope", metadata: { dealId } },
    ),
  ]);

  const unwrap = (r: PromiseSettledResult<any>) =>
    r.status === "fulfilled"
      ? r.value?.ok
        ? r.value.value ?? r.value
        : { ok: false, error: r.value?.error ?? null }
      : { ok: false, error: String(r.reason) };

  return {
    deal_id: dealId,
    bundle: unwrap(legs[0]!),
    title: unwrap(legs[1]!),
    esign: unwrap(legs[2]!),
  };
}
