// Payload-embedded capital: the execution JSON must physically carry a
// clearing-network token (FedNow / RTP reference, or institutional stablecoin
// hash). No token, no vault door. 402 Payment Required.
import { createHash } from "crypto";
import { validateWireReference } from "./settlement-rail.server";

export type CapitalToken = {
  network: "FEDNOW" | "RTP" | "STABLECOIN" | "WIRE";
  reference: string;
  amount: number;
  token_hash: string;
};

const NETWORKS = new Set(["FEDNOW", "RTP", "STABLECOIN", "WIRE"]);

/** Millisecond ceiling on capital authorization (poison pill). */
export const CAPITAL_TTL_MS = 500;

export function parseCapitalToken(parsed: any): { ok: true; token: CapitalToken } | { ok: false; error: string } {
  const raw = parsed?.capital_token ?? parsed?.emd_token ?? null;
  if (!raw || typeof raw !== "object") return { ok: false, error: "capital_token_missing" };
  const hasFedwireRef = Boolean(raw.imad ?? raw.omad ?? raw.fedwire_hash);
  // Push model: an IMAD/OMAD alone implies the FedWire rail.
  const network = String(raw.network ?? raw.rail ?? (hasFedwireRef ? "WIRE" : "")).toUpperCase();
  const reference = String(
    raw.imad ?? raw.omad ?? raw.fedwire_hash ?? raw.reference ?? raw.reference_id ?? raw.hash ?? "",
  ).trim();
  // Amount falls back to the strike's execution amount when the wire proof
  // carries only the reference.
  const amount = Number(raw.amount ?? raw.amount_usd ?? parsed?.execution_amount ?? 0);
  if (!NETWORKS.has(network)) return { ok: false, error: "capital_token_unsupported_network" };
  if (!(amount > 0)) return { ok: false, error: "capital_token_underfunded" };
  // Push model: the reference IS the proof the wire was already initiated to
  // our routing number. No reference, no seal.
  const v = validateWireReference(reference);
  if (!v.ok) return { ok: false, error: v.error ?? "fedwire_reference_invalid" };
  return {
    ok: true,
    token: {
      network: network as CapitalToken["network"],
      reference,
      amount,
      token_hash: createHash("sha256").update(`${network}:${reference}:${amount.toFixed(2)}`).digest("hex"),
    },
  };
}


/**
 * Authorizes the token against the clearing rail inside a hard 500ms window.
 * Timeout => poison pill (408) so the asset never sits on a stuck wire.
 */
export async function authorizeCapital(
  token: CapitalToken,
  requiredAmount: number,
  opts?: { railUrl?: string | null },
): Promise<{ ok: true; authorized_ms: number } | { ok: false; error: string; status: number }> {
  const t0 = Date.now();
  if (token.amount + 0.01 < requiredAmount)
    return { ok: false, error: "capital_token_underfunded", status: 402 };

  const authorize = async () => {
    const endpoint = opts?.railUrl || null; // push model: no outbound pull rail
    if (!endpoint) return true; // no external rail configured: token math is authoritative
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        network: token.network,
        reference: token.reference,
        amount: token.amount,
      }),
    });
    return res.ok;
  };


  let timer: ReturnType<typeof setTimeout> | undefined;
  const pill = new Promise<"TIMEOUT">((r) => {
    timer = setTimeout(() => r("TIMEOUT"), CAPITAL_TTL_MS);
  });
  try {
    const outcome = await Promise.race([authorize().catch(() => false), pill]);
    if (outcome === "TIMEOUT")
      return { ok: false, error: "capital_authorization_timeout", status: 408 };
    if (!outcome) return { ok: false, error: "capital_token_rejected", status: 402 };
    return { ok: true, authorized_ms: Date.now() - t0 };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
