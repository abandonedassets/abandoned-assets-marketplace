// Qualified Intermediary (QI) deed detection + IRS §1031 identification window.
// Pure, deterministic, no network. Fail-forward by construction.

const QI_PATTERNS: RegExp[] = [
  /\bqualified\s+intermediar(y|ies)\b/i,
  /\bintermediar(y|ies)\b/i,
  /\b1031\b/i,
  /\bexchange\s+(co|company|corp|corporation|services|svcs|accommodator)\b/i,
  /\baccommodat(or|ion)\b/i,
  /\blike[-\s]?kind\b/i,
  /\bipx\s?1031\b/i,
  /\bfirst\s+american\s+exchange\b/i,
  /\basset\s+exchange\s+company\b/i,
  /\binvestment\s+property\s+exchange\b/i,
  /\bexeter\s+1031\b/i,
  /\bstarker\b/i,
];

/** IRS §1031: 45 days to formally identify replacement property. */
export const IDENTIFICATION_WINDOW_DAYS = 45;

export function detectQualifiedIntermediary(...fields: (string | null | undefined)[]): {
  is1031: boolean;
  qiEntity: string | null;
} {
  for (const raw of fields) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    if (QI_PATTERNS.some((re) => re.test(s))) {
      return { is1031: true, qiEntity: s.slice(0, 180) };
    }
  }
  return { is1031: false, qiEntity: null };
}

/**
 * 45-day identification deadline from the disposition (deed transfer) date.
 * Falls back to "now" when the recorder date is missing — capital is assumed
 * freshly parked, never dropped.
 */
export function exchangeWindow(transferDate?: string | number | null): {
  identifiedAt: string;
  deadlineAt: string;
  daysRemaining: number;
} {
  let t = Date.now();
  if (transferDate != null && String(transferDate).trim() !== "") {
    const raw = String(transferDate);
    const parsed = /^\d{10,}$/.test(raw) ? Number(raw) : Date.parse(raw);
    if (isFinite(parsed) && parsed > 0) t = parsed;
  }
  const deadline = t + IDENTIFICATION_WINDOW_DAYS * 86400_000;
  return {
    identifiedAt: new Date(t).toISOString(),
    deadlineAt: new Date(deadline).toISOString(),
    daysRemaining: Math.max(0, Math.ceil((deadline - Date.now()) / 86400_000)),
  };
}

/** Compliance block appended to every outbound buyer payload. */
export function likeKindMetadata(input: {
  is1031: boolean;
  qiEntity?: string | null;
  deadlineAt?: string | null;
  acreage?: number | null;
  timberDensityScore?: number | null;
  estimatedStumpageMbf?: number | null;
  contractPrice?: number | null;
  lienTotal?: number | null;
}) {
  const net =
    input.contractPrice != null
      ? Number(input.contractPrice) - Number(input.lienTotal ?? 0)
      : null;
  return {
    irc_section: "1031",
    like_kind_eligible: !!(input.is1031 || (input.acreage ?? 0) >= 5),
    qualified_intermediary: input.qiEntity ?? null,
    identification_deadline: input.deadlineAt ?? null,
    days_remaining:
      input.deadlineAt != null
        ? Math.max(0, Math.ceil((Date.parse(input.deadlineAt) - Date.now()) / 86400_000))
        : null,
    acreage: input.acreage ?? null,
    standing_timber: {
      // IRC §1031: standing timber and unsevered crops are like-kind real property.
      qualifies_as_real_property: (input.timberDensityScore ?? 0) > 0,
      density_score: input.timberDensityScore ?? null,
      estimated_stumpage_mbf: input.estimatedStumpageMbf ?? null,
    },
    lien_adjusted_net_price: net,
    emd_required_usd: 1000,
  };
}
