// Multi-recipient payout profiles — secondary destinations (Jacquita, daughter)
// that receive a split of a cleared assignment fee. Bank coordinates live in
// `payout_recipient_profiles` (service-role only) with env fallback.
// Pure/fail-forward: never throws into a sweep path.

import type { BeneficiaryKey } from "@/lib/beneficiary-routing";

export type RecipientProfile = {
  id: string | null;
  recipient_key: string;
  display_name: string;
  bank_name: string | null;
  routing_number: string | null;
  account_number: string | null;
  allocation_pct: number; // 0..100
  flat_amount_usd: number;
  is_active: boolean;
  configured: boolean;
};

const ENV_PREFIX: Record<string, string> = {
  PRIMARY: "BLUEVINE",
  JACQUITA: "JAQUITA",
  JAQUITA: "JAQUITA",
  DAUGHTER: "JAZMIN",
  JAZMIN: "JAZMIN",
};

const DEFAULT_NAME: Record<string, string> = {
  JACQUITA: "Jaquita",
  JAQUITA: "Jaquita",
  DAUGHTER: "Jazmin",
  JAZMIN: "Jazmin",
};

function envCoords(key: string) {
  const p = ENV_PREFIX[key] ?? key.toUpperCase();
  return {
    routing: process.env[`${p}_ROUTING_NUMBER`] ?? null,
    account: process.env[`${p}_ACCOUNT_NUMBER`] ?? null,
    bank: process.env[`${p}_BANK_NAME`] ?? null,
    name: process.env[`${p}_BENEFICIARY_NAME`] ?? DEFAULT_NAME[key] ?? null,
  };
}

export async function loadRecipientProfiles(): Promise<RecipientProfile[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("payout_recipient_profiles" as any)
      .select("*")
      .order("recipient_key");
    return ((data ?? []) as any[]).map((r) => {
      const env = envCoords(String(r.recipient_key));
      const routing = r.routing_number ?? env.routing;
      const account = r.account_number ?? env.account;
      return {
        id: String(r.id),
        recipient_key: String(r.recipient_key),
        display_name: String(r.display_name ?? env.name ?? r.recipient_key),
        bank_name: r.bank_name ?? env.bank ?? null,
        routing_number: routing,
        account_number: account,
        allocation_pct: Number(r.allocation_pct ?? 0) || 0,
        flat_amount_usd: Number(r.flat_amount_usd ?? 0) || 0,
        is_active: r.is_active !== false,
        configured: Boolean(routing && account),
      } satisfies RecipientProfile;
    });
  } catch (e) {
    console.error("[recipients] load failed", e);
    return [];
  }
}

/** Never leak full coordinates to the client. */
export function maskProfile(p: RecipientProfile) {
  return {
    id: p.id,
    recipient_key: p.recipient_key,
    display_name: p.display_name,
    bank_name: p.bank_name,
    routing_prefix: p.routing_number ? String(p.routing_number).slice(0, 3) : null,
    account_last4: p.account_number ? String(p.account_number).slice(-4) : null,
    allocation_pct: p.allocation_pct,
    flat_amount_usd: p.flat_amount_usd,
    is_active: p.is_active,
    configured: p.configured,
  };
}

export type RecipientSplit = {
  recipient_key: string;
  profile_id: string | null;
  display_name: string;
  amount_usd: number;
  basis: "flat" | "pct";
  configured: boolean;
};

/**
 * Deterministic split of a cleared fee: flat amounts first, then percentages
 * of the ORIGINAL net. Recipients can never take more than the net; the
 * remainder always stays with PRIMARY.
 */
export function computeRecipientSplits(
  profiles: RecipientProfile[],
  netUsd: number,
): { legs: RecipientSplit[]; primary_remainder_usd: number } {
  const netCents = Math.max(0, Math.round((Number(netUsd) || 0) * 100));
  let remaining = netCents;
  const legs: RecipientSplit[] = [];

  const active = profiles.filter(
    (p) => p.is_active && p.recipient_key !== "PRIMARY" && (p.flat_amount_usd > 0 || p.allocation_pct > 0),
  );

  for (const p of active) {
    let cents = 0;
    let basis: "flat" | "pct" = "pct";
    if (p.flat_amount_usd > 0) {
      cents = Math.round(p.flat_amount_usd * 100);
      basis = "flat";
    } else {
      cents = Math.floor((netCents * p.allocation_pct) / 100);
    }
    cents = Math.min(cents, remaining);
    if (cents <= 0) continue;
    remaining -= cents;
    legs.push({
      recipient_key: p.recipient_key,
      profile_id: p.id,
      display_name: p.display_name,
      amount_usd: cents / 100,
      basis,
      configured: p.configured,
    });
  }

  return { legs, primary_remainder_usd: remaining / 100 };
}

export type { BeneficiaryKey };
