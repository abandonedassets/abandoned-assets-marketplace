// Stripe ACH debit rail — raw routing/account tokenized server-side, then
// charged immediately via PaymentIntent (us_bank_account + instant mandate).
// Uses the Stripe REST API directly (no SDK) so it runs in the Worker runtime.
// Fail-forward: returns a typed error, never throws into a sweep/webhook path.

const API = "https://api.stripe.com/v1";

export type StripeAchResult =
  | { ok: true; id: string; status: string; url: string | null }
  | { ok: false; error: string; detail?: string };

export type BankAccountInput = {
  routing_number: string;
  account_number: string;
  account_holder_name: string;
  account_holder_type?: "individual" | "company";
};

export function stripeConfigured(): boolean {
  return Boolean(process.env["STRIPE_SECRET_KEY"]);
}

function form(obj: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== "") p.append(k, String(v));
  }
  return p.toString();
}

async function stripeCall(
  path: string,
  body: Record<string, string | number | undefined | null>,
  idempotencyKey?: string,
): Promise<{ ok: boolean; json: any; status: number }> {
  const key = process.env["STRIPE_SECRET_KEY"]!;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${API}${path}`, { method: "POST", headers, body: form(body) });
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok, json, status: res.status };
}

/** Pull the payer bank coordinates from explicit input or env fallback. */
export function resolveBankAccount(
  input?: Partial<BankAccountInput> | null,
): BankAccountInput | null {
  const routing = input?.routing_number || "";
  const account = input?.account_number || "";
  const name = input?.account_holder_name || "";

  if (!/^\d{9}$/.test(routing) || account.length < 4 || !name) return null;
  return {
    routing_number: routing,
    account_number: account,
    account_holder_name: name,
    account_holder_type: (input?.account_holder_type as "company") ?? "company",
  };
}

/**
 * Tokenize raw bank coordinates and immediately initiate an ACH debit.
 * Amount is charged in USD cents.
 */
export async function stripeAchDebit(input: {
  dealId: string;
  amountUsd: number;
  memo: string;
  bank?: Partial<BankAccountInput> | null;
  counterpartyEmail?: string | null;
  idempotencyKey?: string;
}): Promise<StripeAchResult> {
  try {
    if (!stripeConfigured()) return { ok: false, error: "stripe_secret_key_missing" };
    if (!isFinite(input.amountUsd) || input.amountUsd <= 0)
      return { ok: false, error: "invalid_amount" };

    const bank = resolveBankAccount(input.bank);
    if (!bank) return { ok: false, error: "payer_bank_coordinates_missing" };

    const idem = input.idempotencyKey ?? `stripe_ach_${input.dealId}`;

    // 1. Tokenize the raw routing/account server-side.
    const pm = await stripeCall(
      "/payment_methods",
      {
        type: "us_bank_account",
        "us_bank_account[routing_number]": bank.routing_number,
        "us_bank_account[account_number]": bank.account_number,
        "us_bank_account[account_holder_type]": bank.account_holder_type ?? "company",
        "billing_details[name]": bank.account_holder_name,
        "billing_details[email]": input.counterpartyEmail ?? undefined,
      },
      `${idem}_pm`,
    );
    if (!pm.ok)
      return {
        ok: false,
        error: "stripe_tokenize_failed",
        detail: pm.json?.error?.message ?? `http_${pm.status}`,
      };

    // 2. Create + confirm the ACH debit in one call.
    const pi = await stripeCall(
      "/payment_intents",
      {
        amount: Math.round(input.amountUsd * 100),
        currency: "usd",
        "payment_method_types[]": "us_bank_account",
        payment_method: pm.json.id,
        confirm: "true",
        description: input.memo,
        "metadata[deal_id]": input.dealId,
        "mandate_data[customer_acceptance][type]": "offline",
        "payment_method_options[us_bank_account][verification_method]": "instant",
      },
      `${idem}_pi`,
    );
    if (!pi.ok)
      return {
        ok: false,
        error: "stripe_ach_failed",
        detail: pi.json?.error?.message ?? `http_${pi.status}`,
      };

    return {
      ok: true,
      id: String(pi.json.id),
      status: String(pi.json.status ?? "processing"),
      url: pi.json?.next_action?.hosted_instructions_url ?? null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
