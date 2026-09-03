// Settlement-request minting — Bluevine ACH/wire rails only.
// Stripe Checkout is fully removed. This issues (or reuses) a Bluevine
// collection instruction for a deal's assignment fee; proceeds settle
// natively into the Bluevine business account.
//
// Note: the persisted columns are still named stripe_session_* in the
// database (legacy schema); they now hold Bluevine references/URLs.

const MIN_MARGIN_USD = 6_000;
const SESSION_TTL_SECONDS = 72 * 3600;

export type MintResult =
  | {
      ok: true;
      url: string;
      session_id: string;
      expires_at: number;
      reused: boolean;
    }
  | { ok: false; status: number; error: string; detail?: string };

export async function mintOrReuseCheckoutSession(
  dealId: string,
  origin: string,
  opts: { forceFresh?: boolean } = {},
): Promise<MintResult> {
  if (!dealId) {
    return { ok: false, status: 400, error: "deal_id_required" };
  }

  const { liveRailStatus } = await import("@/lib/live-rails.server");
  const rails = liveRailStatus();
  if (!rails.live) {
    return {
      ok: false,
      status: 500,
      error: "live_rail_missing",
      detail: rails.reason ?? "mock_mode",
    };
  }

  const { issueAchDebit } = await import("@/lib/bluevine-rails.server");


  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const { data: deal, error: dealErr } = await supabaseAdmin
    .from("closing_pipeline_items")
    .select(
      "id, zip, address, base_contract_price, optimized_acquisition_premium, status, auto_clearance_ready, stripe_session_id, stripe_session_url, stripe_session_expires_at",
    )
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr) {
    return {
      ok: false,
      status: 500,
      error: "lookup_failed",
      detail: dealErr.message,
    };
  }
  if (!deal) return { ok: false, status: 404, error: "deal_not_found" };

  if (deal.status === "Funds-Cleared" || deal.status === "Closed") {
    return {
      ok: false,
      status: 409,
      error: "already_cleared",
      detail: deal.status,
    };
  }

  const marginUsd = Number(deal.optimized_acquisition_premium ?? 0);
  if (!isFinite(marginUsd) || marginUsd < MIN_MARGIN_USD) {
    return {
      ok: false,
      status: 422,
      error: "margin_below_threshold",
      detail: `margin=${marginUsd} min=${MIN_MARGIN_USD}`,
    };
  }

  // Reuse path: existing settlement instruction with >5min remaining.
  if (
    !opts.forceFresh &&
    deal.stripe_session_id &&
    deal.stripe_session_url &&
    deal.stripe_session_expires_at &&
    new Date(deal.stripe_session_expires_at).getTime() - Date.now() > 300_000
  ) {
    return {
      ok: true,
      url: deal.stripe_session_url,
      session_id: deal.stripe_session_id,
      expires_at: Math.floor(
        new Date(deal.stripe_session_expires_at).getTime() / 1000,
      ),
      reused: true,
    };
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;

  const rail = await issueAchDebit({
    dealId,
    amountUsd: marginUsd,
    memo: `Assignment Fee Settlement — Deal ${dealId.slice(0, 8)} · ZIP ${deal.zip ?? "—"}`,
    counterpartyRef: dealId,
    idempotencyKey: `bv_settle_${dealId}`,
    origin,
  });

  if (!rail.ok) {
    return {
      ok: false,
      status: 502,
      error: rail.error,
      ...(rail.detail ? { detail: rail.detail } : {}),
    };
  }

  try {
    await supabaseAdmin
      .from("closing_pipeline_items")
      .update({
        stripe_session_id: rail.id,
        stripe_session_url: rail.url,
        stripe_session_expires_at: new Date(expiresAt * 1000).toISOString(),
      })
      .eq("id", dealId);
  } catch {}

  return {
    ok: true,
    url: rail.url,
    session_id: rail.id,
    expires_at: expiresAt,
    reused: false,
  };
}
