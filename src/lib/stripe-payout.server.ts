// Stripe instant payout rail — pays out the available Stripe balance to the
// external bank account linked inside the Stripe Dashboard (tokenized
// destination; no raw routing/account numbers ever touch this codebase).
// Reads STRIPE_RESTRICTED_KEY from the server environment only.

const API = "https://api.stripe.com/v1";

export type PayoutOut =
  | { ok: true; payout_id: string; amount_usd: number; status: string; method: string }
  | { ok: false; error: string; detail?: string };

export function stripePayoutConfigured(): boolean {
  return Boolean(process.env["STRIPE_RESTRICTED_KEY"] ?? process.env["STRIPE_SECRET_KEY"]);
}

/** Create a payout to the linked external account. Falls back to standard
 *  speed when the account is not eligible for instant. */
export async function stripeInstantPayout(input: {
  amountUsd: number;
  description?: string;
  dealId?: string | null;
  idempotencyKey?: string;
  method?: "instant" | "standard";
}): Promise<PayoutOut> {
  try {
    const key = process.env["STRIPE_RESTRICTED_KEY"] ?? process.env["STRIPE_SECRET_KEY"];
    if (!key) return { ok: false, error: "stripe_restricted_key_missing" };
    if (!isFinite(input.amountUsd) || input.amountUsd <= 0)
      return { ok: false, error: "invalid_amount" };

    const send = async (method: "instant" | "standard") => {
      const body = new URLSearchParams({
        amount: String(Math.round(input.amountUsd * 100)),
        currency: "usd",
        method,
      });
      if (input.description) body.append("description", input.description);
      if (input.dealId) body.append("metadata[deal_id]", input.dealId);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      };
      const idem = input.idempotencyKey ?? (input.dealId ? `stripe_payout_${input.dealId}` : null);
      if (idem) headers["Idempotency-Key"] = `${idem}_${method}`;
      const res = await fetch(`${API}/payouts`, { method: "POST", headers, body });
      const json: any = await res.json().catch(() => ({}));
      return { ok: res.ok, json, status: res.status };
    };

    const wanted = input.method ?? "instant";
    let r = await send(wanted);
    if (!r.ok && wanted === "instant") {
      console.warn("[stripe-payout] instant rejected, retrying standard:", r.json?.error?.message);
      r = await send("standard");
    }
    if (!r.ok)
      return {
        ok: false,
        error: "stripe_payout_failed",
        detail: r.json?.error?.message ?? `http_${r.status}`,
      };

    return {
      ok: true,
      payout_id: String(r.json.id),
      amount_usd: Number(r.json.amount ?? 0) / 100,
      status: String(r.json.status ?? "pending"),
      method: String(r.json.method ?? "standard"),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Current Stripe balance in USD — used by the terminal's live probe. */
export async function stripeBalance(): Promise<{
  configured: boolean;
  available_usd: number;
  pending_usd: number;
  error?: string;
}> {
  const key = process.env["STRIPE_RESTRICTED_KEY"] ?? process.env["STRIPE_SECRET_KEY"];
  if (!key) return { configured: false, available_usd: 0, pending_usd: 0 };
  try {
    const res = await fetch(`${API}/balance`, { headers: { Authorization: `Bearer ${key}` } });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok)
      return {
        configured: true,
        available_usd: 0,
        pending_usd: 0,
        error: j?.error?.message ?? `http_${res.status}`,
      };
    const sum = (arr: any[]) =>
      (arr ?? []).filter((b) => b.currency === "usd").reduce((a, b) => a + Number(b.amount ?? 0), 0) / 100;
    return { configured: true, available_usd: sum(j.available), pending_usd: sum(j.pending) };
  } catch (e) {
    return {
      configured: true,
      available_usd: 0,
      pending_usd: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
