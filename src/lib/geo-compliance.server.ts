// State-level wholesaling compliance fence.
// Rules are declarative so the intake parser, title-cloud engine, and dispatch
// layer all resolve the same verdict from a single source of truth.

export type ComplianceTier = "CLEAR" | "RESTRICTED" | "PROHIBITED";

export type StateRule = {
  tier: ComplianceTier;
  /** Block automated Memorandum of Contract e-recording (title clouding). */
  blockErecording: boolean;
  /** Seller right-of-rescission window in business days (0 = none codified). */
  rescissionBusinessDays: number;
  note: string;
};

export const STATE_RULES: Record<string, StateRule> = {
  SC: {
    tier: "PROHIBITED",
    blockErecording: true,
    rescissionBusinessDays: 0,
    note: "SC H.4754 — wholesaling is licensed brokerage activity. Manual licensed-broker review required.",
  },
  IL: {
    tier: "RESTRICTED",
    blockErecording: false,
    rescissionBusinessDays: 0,
    note: "IL PA 101-0357 — max one unlicensed wholesale transaction per 12 months. Second deal is a Class A misdemeanor.",
  },
  OK: {
    tier: "RESTRICTED",
    blockErecording: true,
    rescissionBusinessDays: 2,
    note: "OK SB 1075 — recording a memorandum that clouds title is prohibited. Seller holds a 2-business-day right to cancel.",
  },
};

export function normalizeState(state: unknown): string | null {
  const s = String(state ?? "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

export function assessState(state: unknown): StateRule & { state: string | null } {
  const s = normalizeState(state);
  const rule = (s && STATE_RULES[s]) || {
    tier: "CLEAR" as const,
    blockErecording: false,
    rescissionBusinessDays: 0,
    note: "No state-level wholesaling restriction on file.",
  };
  return { state: s, ...rule };
}

/** Tags applied to closing_pipeline_items.enrichment_tags at intake. */
export function complianceTags(state: unknown): string[] {
  const a = assessState(state);
  if (a.tier === "CLEAR") return [];
  const tags = [`COMPLIANCE-${a.tier}`, `STATE-${a.state}`];
  if (a.blockErecording) tags.push("ERECORDING-BLOCKED");
  if (a.rescissionBusinessDays > 0) tags.push(`RESCISSION-${a.rescissionBusinessDays}BD`);
  return tags;
}
