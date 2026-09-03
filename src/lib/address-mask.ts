// Pre-execution address redaction. Exact street numbers, GPS and seller
// identity never leave the database until an assignment contract is signed.

export type MaskInput = {
  address?: string | null;
  zip?: string | null;
  apn?: string | null;
  external_id?: string | null;
};

/** "1420 W 25th St" -> "W 25th St" (house number + unit stripped). */
export function streetNameOnly(address?: string | null): string | null {
  if (!address) return null;
  const first = String(address).split(",")[0]?.trim() ?? "";
  const stripped = first
    .replace(/^[#\d][\d\-\/]*\s+/, "")
    .replace(/\s+(apt|unit|ste|suite|#)\s*\S+$/i, "")
    .trim();
  return stripped || null;
}

/** '[Street Name] Parcel | Zip 45214 | APN 123-456' */
export function maskedLabel(a: MaskInput): string {
  const street = streetNameOnly(a.address);
  const parts = [
    street ? `${street} Parcel` : "Off-Market Parcel",
    a.zip ? `Zip ${a.zip}` : null,
    a.apn ? `APN ${a.apn}` : a.external_id ? `REF ${a.external_id}` : null,
  ].filter(Boolean);
  return parts.join(" | ");
}

const SELLER_KEYS = /^(seller|owner|mailing|contact|legal_description|deed|grantor)/i;
const GEO_KEYS =
  /^(lat|lng|lon|latitude|longitude|geo|gps|coordinates|street|address_line|full_address|situs)/i;

/** Strip street numbers, GPS and seller/legal detail from a contract payload. */
export function maskContractPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const p = { ...(payload as Record<string, any>) };

  const prop = { ...(p["property"] ?? {}) };
  const label = maskedLabel({
    address: prop["address"],
    zip: prop["zip"],
    apn: prop["apn"],
  });
  prop["address"] = label;
  prop["masked"] = true;
  delete prop["city"];
  for (const k of Object.keys(prop)) {
    if (GEO_KEYS.test(k) || SELLER_KEYS.test(k)) delete prop[k];
  }
  prop["zip"] = null;
  p["property"] = prop;

  for (const k of Object.keys(p)) {
    if (SELLER_KEYS.test(k) && k !== "seller_escrow_entity") delete p[k];
  }
  delete p["wiring"];
  return p;
}
