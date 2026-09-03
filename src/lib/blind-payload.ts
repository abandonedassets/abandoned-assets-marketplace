// Blind Asset Protocol.
// Pre-lock broadcasts expose economics only. Street address, APN/parcel,
// city/geo and seller contact stay sealed until the buyer holds a live lock
// and settlement instructions have been generated.

export type BlindSource = Record<string, unknown>;

const n = (v: unknown) => (v == null ? null : Number(v) || 0);

/** Strictly the six disclosable fields + identifiers. */
export function blindAsset(r: BlindSource) {
  return {
    deal_id: r["id"] ?? r["deal_id"] ?? null,
    zip: r["zip"] ?? null,
    beds: r["beds"] ?? null,
    baths: r["baths"] ?? null,
    sqft: r["sqft"] ?? null,
    estimated_arv: n(r["calculated_arv"]),
    estimated_rehab: n(r["estimated_repairs"]),
    assignment_fee: n(r["optimized_acquisition_premium"]),
    blind: true as const,
  };
}

/**
 * True only when this viewer holds the asset AND has posted real friction:
 * an authorized EMD hold or generated wire instructions. A zero-cost lock
 * alone never unseals address/APN — that is what enables disintermediation.
 */
export function lockUnsealed(
  r: BlindSource,
  viewerBoxId?: string | null,
): boolean {
  const exp = r["m2m_expires_at"] ? Date.parse(String(r["m2m_expires_at"])) : 0;
  const live = exp > Date.now();
  const owner = String(r["m2m_box_id"] ?? "");
  const funded =
    Boolean(r["wire_instructed_at"]) ||
    String(r["earnest_hold_status"] ?? "") === "authorized" ||
    String(r["lock_phase"] ?? "") === "WIRE_IN_FLIGHT";
  if (live && funded && viewerBoxId && owner && owner === viewerBoxId) return true;
  // Settled / executed assets are fully disclosed to their counterparty.
  return (
    Boolean(viewerBoxId) &&
    owner === viewerBoxId &&
    ["WIRE_PENDING_VERIFICATION", "SETTLED_PAID"].includes(String(r["payout_status"] ?? ""))
  );
}

/** Merge: full detail when unsealed, blind economics otherwise. */
export function disclose(r: BlindSource, viewerBoxId?: string | null) {
  const base = blindAsset(r);
  if (!lockUnsealed(r, viewerBoxId)) return base;
  return {
    ...base,
    blind: false as unknown as true,
    address: r["address"] ?? null,
    city: r["city"] ?? null,
    state: r["state"] ?? null,
    apn: r["apn"] ?? null,
  };
}
