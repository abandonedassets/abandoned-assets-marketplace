// Internal Title Validation Engine.
//
// Replaces the hard dependency on a third-party title vendor API with a
// deterministic in-house heuristic: parcel-identifier normalization plus
// distress-flag screening. Pure + client-safe (no I/O, no env).

export type TitleVerdict = {
  title_status: "Insured" | "Uninsurable" | "Pending";
  apn: string | null;
  apn_source: "county_record" | "provisional_internal" | null;
  reasons: string[];
};

const APN_OK = /^[0-9A-Za-z][0-9A-Za-z\-.\s/]{4,29}$/;

/** Deterministic provisional parcel id derived from stable record fields. */
export function provisionalApn(input: {
  id?: string | null;
  external_id?: string | null;
  county?: string | null;
  state?: string | null;
  zip?: string | null;
  address?: string | null;
}): string | null {
  const seed = [input.external_id, input.id, input.address, input.zip].filter(Boolean).join("|");
  if (!seed) return null;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
  const st = (input.state ?? "US").slice(0, 2).toUpperCase();
  const zip = (input.zip ?? "00000").slice(0, 5);
  return `PROV-${st}${zip}-${hex.slice(0, 4)}-${hex.slice(4)}`;
}

const BLOCKING_TAGS = [
  "legal_hold",
  "legal-hold",
  "uninsurable",
  "tax_deed_void",
  "bankruptcy_stay",
  "clouded_title",
  "lis_pendens",
];

export function validateTitle(rec: {
  id?: string | null;
  external_id?: string | null;
  apn?: string | null;
  title_status?: string | null;
  address?: string | null;
  county?: string | null;
  state?: string | null;
  zip?: string | null;
  enrichment_tags?: string[] | null;
  base_contract_price?: number | null;
  priority_override?: boolean | null;
}): TitleVerdict {
  const reasons: string[] = [];
  const tags = (rec.enrichment_tags ?? []).map((t) => String(t).toLowerCase());
  const blocked = tags.filter((t) => BLOCKING_TAGS.some((b) => t.includes(b)));

  if (String(rec.title_status ?? "") === "Uninsurable" || blocked.length) {
    return {
      title_status: "Uninsurable",
      apn: rec.apn ?? null,
      apn_source: rec.apn ? "county_record" : null,
      reasons: blocked.length ? [`blocking_flags:${blocked.join(",")}`] : ["marked_uninsurable"],
    };
  }

  let apn = (rec.apn ?? "").trim() || null;
  let apn_source: TitleVerdict["apn_source"] = null;
  if (apn && APN_OK.test(apn)) {
    apn_source = "county_record";
    reasons.push("apn_format_valid");
  } else {
    apn = provisionalApn(rec);
    if (apn) {
      apn_source = "provisional_internal";
      reasons.push("apn_synthesized_internal");
    }
  }

  const price = Number(rec.base_contract_price ?? 0);
  if (!apn) return { title_status: "Pending", apn: null, apn_source: null, reasons: ["no_parcel_seed"] };
  if (!(price > 1)) return { title_status: "Pending", apn, apn_source, reasons: [...reasons, "non_economic_price"] };
  if (!rec.address) return { title_status: "Pending", apn, apn_source, reasons: [...reasons, "no_situs_address"] };

  reasons.push("internal_underwriting_cleared");
  return { title_status: "Insured", apn, apn_source, reasons };
}
