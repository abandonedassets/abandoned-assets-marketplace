// Plaid rail — Bluevine Business Checking (institution ins_127296).
//
// Bluevine exposes no public REST facility; money movement is executed through
// certified aggregators. This module implements the Plaid Link token-exchange
// workflow plus Plaid Transfer (ACH) execution for automated settlement sweeps.
//
// Credentials live in serverless secrets: PLAID_CLIENT_ID / PLAID_SECRET /
// PLAID_ENV. The long-lived access_token is stored server-side only in
// public.plaid_items (service_role only, no RLS policy => unreachable by clients).
//
// Fail-forward: nothing here throws into a webhook or sweep path.

export const BLUEVINE_INSTITUTION_ID = "ins_127296";

export type PlaidTransferResult =
  | {
      ok: true;
      transfer_id: string;
      authorization_id: string;
      status: string;
      live: true;
    }
  | { ok: false; error: string; detail?: string };

function env() {
  return (process.env["PLAID_ENV"] || "production").toLowerCase();
}

function host(): string {
  const e = env();
  if (e === "sandbox") return "https://sandbox.plaid.com";
  if (e === "development") return "https://development.plaid.com";
  return "https://production.plaid.com";
}

export function plaidConfigured(): boolean {
  return Boolean(process.env["PLAID_CLIENT_ID"] && process.env["PLAID_SECRET"]);
}

export async function plaidCall(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(`${host()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env["PLAID_CLIENT_ID"],
      secret: process.env["PLAID_SECRET"],
      ...body,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export type LinkedItem = {
  id: string;
  item_id: string;
  access_token: string;
  account_id: string | null;
  account_mask: string | null;
  account_name: string | null;
  institution_name: string;
};

/** The single active Bluevine link, if any. */
export async function getLinkedItem(): Promise<LinkedItem | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("plaid_items" as any)
      .select("id,item_id,access_token,account_id,account_mask,account_name,institution_name")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as unknown as LinkedItem) ?? null;
  } catch {
    return null;
  }
}

/** Masked posture for dashboards / readiness probes. */
export async function plaidStatus() {
  const item = await getLinkedItem();
  return {
    rail: "plaid_ach" as const,
    institution_id: BLUEVINE_INSTITUTION_ID,
    env: env(),
    credentials_ready: plaidConfigured(),
    linked: Boolean(item),
    account_mask: item?.account_mask ?? null,
    account_name: item?.account_name ?? null,
    institution_name: item?.institution_name ?? "Bluevine",
  };
}

/** Step 1 — mint a Link token scoped to Bluevine. */
export async function createLinkToken(userId: string, redirectUri?: string | null) {
  if (!plaidConfigured()) return { ok: false as const, error: "plaid_credentials_missing" };
  const r = await plaidCall("/link/token/create", {
    client_name: "ReelEdge Settlement Terminal",
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: userId },
    products: ["auth", "transfer"],
    institution_id: BLUEVINE_INSTITUTION_ID,
    ...(redirectUri ? { redirect_uri: redirectUri } : {}),
  });
  if (!r.ok) {
    return {
      ok: false as const,
      error: "link_token_failed",
      detail: r.json?.error_message ?? `http_${r.status}`,
    };
  }
  return { ok: true as const, link_token: String(r.json.link_token), expiration: r.json.expiration };
}

/** Step 2 — exchange the public token and persist the access token server-side. */
export async function exchangePublicToken(
  publicToken: string,
  userId: string | null,
  accountId?: string | null,
) {
  if (!plaidConfigured()) return { ok: false as const, error: "plaid_credentials_missing" };

  const ex = await plaidCall("/item/public_token/exchange", { public_token: publicToken });
  if (!ex.ok) {
    return {
      ok: false as const,
      error: "exchange_failed",
      detail: ex.json?.error_message ?? `http_${ex.status}`,
    };
  }

  const accessToken = String(ex.json.access_token);
  const itemId = String(ex.json.item_id);

  // Resolve the checking account (prefer the one the user selected).
  let account_id = accountId ?? null;
  let account_mask: string | null = null;
  let account_name: string | null = null;
  try {
    const acc = await plaidCall("/accounts/get", { access_token: accessToken });
    const list: any[] = acc.json?.accounts ?? [];
    const chosen =
      list.find((a) => a.account_id === account_id) ??
      list.find((a) => a.subtype === "checking") ??
      list[0];
    if (chosen) {
      account_id = chosen.account_id;
      account_mask = chosen.mask ?? null;
      account_name = chosen.name ?? null;
    }
  } catch {
    /* non-fatal */
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Single active link: retire prior items.
  await supabaseAdmin
    .from("plaid_items" as any)
    .update({ status: "retired", updated_at: new Date().toISOString() } as never)
    .eq("status", "active");

  await supabaseAdmin.from("plaid_items" as any).upsert(
    {
      item_id: itemId,
      access_token: accessToken,
      institution_id: BLUEVINE_INSTITUTION_ID,
      institution_name: "Bluevine",
      account_id,
      account_mask,
      account_name,
      status: "active",
      linked_by: userId,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "item_id" },
  );

  return { ok: true as const, item_id: itemId, account_mask, account_name };
}

export async function unlinkPlaid() {
  const item = await getLinkedItem();
  if (!item) return { ok: true as const, removed: false };
  try {
    await plaidCall("/item/remove", { access_token: item.access_token });
  } catch {
    /* best effort */
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("plaid_items" as any)
    .update({ status: "retired", updated_at: new Date().toISOString() } as never)
    .eq("id", item.id);
  return { ok: true as const, removed: true };
}

/**
 * Execute an ACH transfer on the linked Bluevine account.
 * direction "debit"  = pull funds INTO Bluevine (collections)
 * direction "credit" = push funds OUT of Bluevine (disbursements)
 */
export async function executePlaidTransfer(input: {
  dealId: string;
  amountUsd: number;
  direction: "debit" | "credit";
  memo: string;
  counterpartyName: string;
  idempotencyKey?: string;
}): Promise<PlaidTransferResult> {
  try {
    if (!plaidConfigured()) return { ok: false, error: "plaid_credentials_missing" };
    if (!isFinite(input.amountUsd) || input.amountUsd <= 0)
      return { ok: false, error: "invalid_amount" };

    const item = await getLinkedItem();
    if (!item || !item.account_id) return { ok: false, error: "bluevine_not_linked" };

    const amount = input.amountUsd.toFixed(2);
    const idem = (input.idempotencyKey ?? `plaid_${input.direction}_${input.dealId}`).slice(0, 50);

    const auth = await plaidCall("/transfer/authorization/create", {
      access_token: item.access_token,
      account_id: item.account_id,
      type: input.direction,
      network: "ach",
      amount,
      ach_class: "ccd",
      user: { legal_name: input.counterpartyName },
      idempotency_key: idem,
    });
    if (!auth.ok) {
      return {
        ok: false,
        error: "authorization_failed",
        detail: auth.json?.error_message ?? `http_${auth.status}`,
      };
    }
    const authorization = auth.json?.authorization;
    if (authorization?.decision === "declined") {
      return {
        ok: false,
        error: "authorization_declined",
        detail: authorization?.decision_rationale?.description ?? "declined",
      };
    }

    const created = await plaidCall("/transfer/create", {
      access_token: item.access_token,
      account_id: item.account_id,
      authorization_id: authorization.id,
      description: input.memo.slice(0, 15) || "ASSIGNFEE",
    });
    if (!created.ok) {
      return {
        ok: false,
        error: "transfer_failed",
        detail: created.json?.error_message ?? `http_${created.status}`,
      };
    }

    const transfer = created.json?.transfer ?? {};
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("plaid_transfers" as any).upsert(
        {
          deal_id: input.dealId,
          transfer_id: String(transfer.id),
          authorization_id: String(authorization.id),
          direction: input.direction,
          amount_usd: input.amountUsd,
          status: String(transfer.status ?? "pending"),
          idempotency_key: idem,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "transfer_id" },
      );
    } catch {
      /* telemetry optional */
    }

    return {
      ok: true,
      transfer_id: String(transfer.id),
      authorization_id: String(authorization.id),
      status: String(transfer.status ?? "pending"),
      live: true,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
