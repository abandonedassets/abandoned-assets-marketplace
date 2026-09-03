// Anti-Phishing Cloud Seal.
// Every outbound settlement packet carries an HMAC-SHA256 seal bound to the
// asset id + the exact routing/account integers minted in our database. The
// buyer's treasury desk opens the verification link and the server re-derives
// the seal from live DB state — a swapped routing number can never validate.

import { appBaseUrl } from "./links";

function secret(): string {
  return (
    process.env["INTERNAL_TRIGGER_SECRET"] ||
    process.env["PACKET_SIGNING_KEY"] ||
    process.env["M2M_HMAC_SECRET"] ||
    "wire-seal-fallback"
  );
}

export async function wireSeal(input: {
  assetId: string;
  routing: string;
  account: string;
}): Promise<string> {
  const { createHmac } = await import("crypto");
  return createHmac("sha256", secret())
    .update(`${input.assetId}|${input.routing}|${String(input.account).trim()}`)
    .digest("hex");
}

export async function wireSealBundle(input: {
  assetId: string;
  routing: string;
  account: string;
  baseUrl?: string;
}) {
  const seal = await wireSeal(input);
  const base = input.baseUrl ?? appBaseUrl();
  const url = `${base}/api/public/verify-wire?asset_id=${encodeURIComponent(
    input.assetId,
  )}&seal=${seal}`;
  return {
    algorithm: "HMAC-SHA256",
    seal,
    verification_url: url,
    notice:
      "Verify these routing integers against the live issuer record before releasing any wire. If the page does not confirm an exact match, the message was tampered with.",
  };
}

/** Timing-safe compare of a presented seal against live database state. */
export async function verifyWireSeal(assetId: string, presented: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("inbound_wire_accounts")
    .select("routing_number, account_number, bank_name, fbo_name, expected_amount")
    .eq("pipeline_item_id", assetId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const acct = data as Record<string, any> | null;
  if (!acct?.routing_number || !acct?.account_number) {
    return { verified: false as const, reason: "no_live_account_on_record" };
  }

  const expected = await wireSeal({
    assetId,
    routing: String(acct.routing_number),
    account: String(acct.account_number),
  });
  const { timingSafeEqual } = await import("crypto");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(presented ?? ""));
  const ok = a.length === b.length && timingSafeEqual(a, b);

  return ok
    ? {
        verified: true as const,
        bank_name: acct.bank_name ?? null,
        beneficiary: acct.fbo_name ?? null,
        routing_number: String(acct.routing_number),
        account_last4: String(acct.account_number).slice(-4),
        expected_amount_usd: Number(acct.expected_amount ?? 0),
      }
    : { verified: false as const, reason: "seal_mismatch" };
}
