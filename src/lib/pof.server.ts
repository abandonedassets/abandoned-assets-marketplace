// Titanic Safety — Open-Banking Proof of Funds gate.
// A buyer cannot execute an assignment agreement until Plaid confirms liquid
// depository cash >= the required threshold (contract price + EMD).
// Fail-forward: if Plaid credentials are absent the gate is inert (no stall).

import { plaidCall, plaidConfigured } from "@/lib/plaid.server";

export type PofState = {
  enabled: boolean;
  status: "pending" | "passed" | "failed";
  required_usd: number;
  available_usd: number | null;
  institution_name: string | null;
  account_mask: string | null;
  last_error: string | null;
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Required liquidity for a token: contract price + EMD hold. */
export async function requiredForToken(token: string) {
  const supabaseAdmin = await db();
  const { data } = await supabaseAdmin
    .from("esign_requests")
    .select(
      "id, buyer_email, pipeline_item_id, emd_hold_amount, closing_pipeline_items(base_contract_price)",
    )
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;
  const price = Number((data as any)?.closing_pipeline_items?.base_contract_price ?? 0);
  const emd = Number((data as any)?.emd_hold_amount ?? 1000);
  return {
    esign_id: (data as any).id as string,
    buyer_email: (data as any).buyer_email as string | null,
    pipeline_item_id: (data as any).pipeline_item_id as string | null,
    required_usd: Math.max(0, price + emd),
  };
}

export async function getPofState(token: string): Promise<PofState | null> {
  const req = await requiredForToken(token);
  if (!req) return null;
  const supabaseAdmin = await db();
  const { data: row } = await supabaseAdmin
    .from("buyer_pof_verifications" as any)
    .select(
      "status, required_usd, available_usd, institution_name, account_mask, last_error",
    )
    .eq("esign_token", token)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const r = row as any;
  return {
    enabled: plaidConfigured(),
    status: (r?.status as PofState["status"]) ?? "pending",
    required_usd: Number(r?.required_usd ?? req.required_usd),
    available_usd: r?.available_usd == null ? null : Number(r.available_usd),
    institution_name: r?.institution_name ?? null,
    account_mask: r?.account_mask ?? null,
    last_error: r?.last_error ?? null,
  };
}

/** True when execution is allowed (gate passed, or gate inert). */
export async function pofSatisfied(token: string): Promise<boolean> {
  if (!plaidConfigured()) return true;
  const s = await getPofState(token);
  return !s || s.status === "passed";
}

/** Step 1 — Link token for the buyer portal (any US depository institution). */
export async function createBuyerLinkToken(token: string, redirectUri?: string | null) {
  if (!plaidConfigured()) return { ok: false as const, error: "pof_disabled" };
  const req = await requiredForToken(token);
  if (!req) return { ok: false as const, error: "not_found" };
  const r = await plaidCall("/link/token/create", {
    client_name: "ReelEdge Buyer Verification",
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: `pof_${token}`.slice(0, 128) },
    products: ["auth"],
    ...(redirectUri ? { redirect_uri: redirectUri } : {}),
  });
  if (!r.ok)
    return {
      ok: false as const,
      error: "link_token_failed",
      detail: r.json?.error_message ?? `http_${r.status}`,
    };
  return { ok: true as const, link_token: String(r.json.link_token), required_usd: req.required_usd };
}

/** Step 2 — exchange, read live balances, hard-lock if liquidity is short. */
export async function verifyPof(token: string, publicToken: string) {
  try {
    if (!plaidConfigured()) return { ok: true as const, status: "passed" as const, skipped: true };
    const req = await requiredForToken(token);
    if (!req) return { ok: false as const, error: "not_found" };

    const supabaseAdmin = await db();
    const fail = async (error: string, detail?: string) => {
      await supabaseAdmin.from("buyer_pof_verifications" as any).insert({
        esign_token: token,
        pipeline_item_id: req.pipeline_item_id,
        buyer_email: req.buyer_email,
        required_usd: req.required_usd,
        status: "failed",
        last_error: detail ?? error,
      } as never);
      return { ok: false as const, error, detail };
    };

    const ex = await plaidCall("/item/public_token/exchange", { public_token: publicToken });
    if (!ex.ok) return await fail("exchange_failed", ex.json?.error_message);
    const accessToken = String(ex.json.access_token);

    const bal = await plaidCall("/accounts/balance/get", { access_token: accessToken });
    if (!bal.ok) return await fail("balance_failed", bal.json?.error_message);

    const accounts: any[] = bal.json?.accounts ?? [];
    const depository = accounts.filter((a) => a.type === "depository");
    const best = depository
      .map((a) => ({
        a,
        amt: Number(a.balances?.available ?? a.balances?.current ?? 0),
      }))
      .sort((x, y) => y.amt - x.amt)[0];
    const available = depository.reduce(
      (s, a) => s + Number(a.balances?.available ?? a.balances?.current ?? 0),
      0,
    );
    const passed = available >= req.required_usd;

    await supabaseAdmin.from("buyer_pof_verifications" as any).insert({
      esign_token: token,
      pipeline_item_id: req.pipeline_item_id,
      buyer_email: req.buyer_email,
      required_usd: req.required_usd,
      available_usd: available,
      institution_name: bal.json?.item?.institution_id ?? null,
      account_mask: best?.a?.mask ?? null,
      item_id: String(ex.json.item_id ?? ""),
      access_token: accessToken,
      status: passed ? "passed" : "failed",
      verified_at: passed ? new Date().toISOString() : null,
      last_error: passed ? null : "insufficient_liquidity",
    } as never);

    try {
      const { writeAuditLog } = await import("@/lib/webhook-verify.server");
      await writeAuditLog({
        event_type: passed ? "POF_PASS" : "POF_FAIL",
        reason: passed ? "liquidity_confirmed" : "insufficient_liquidity",
        pipeline_item_id: req.pipeline_item_id,
        raw_payload: {
          required_usd: req.required_usd,
          available_usd: available,
          buyer_email: req.buyer_email,
        } as never,
      });
    } catch {
      /* fail-forward */
    }

    if (!passed) {
      try {
        const { recordBuyerEvent } = await import("@/lib/scorecard.server");
        await recordBuyerEvent(req.buyer_email, "pof_failed");
      } catch {
        /* fail-forward */
      }
    }

    return {
      ok: true as const,
      status: passed ? ("passed" as const) : ("failed" as const),
      required_usd: req.required_usd,
      available_usd: available,
    };
  } catch (e) {
    console.error("[pof] verify failed", e);
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
