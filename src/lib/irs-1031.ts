// IRS §1031 identification-clock urgency scoring.
// Pure + deterministic. Day 35-45 buyers are tax-forced buyers: they get first
// look at inventory and pay an escalated assignment premium.

export const IDENT_WINDOW_DAYS = 45;
export const DISTRESS_START_DAY = 35;

export type UrgencyTier = "STANDARD" | "DISTRESSED" | "TERMINAL" | "NONE";

/** Days elapsed in the 45-day identification window (deadline = day 45). */
export function elapsedDays(deadline: string | Date | null | undefined): number | null {
  if (!deadline) return null;
  const t = deadline instanceof Date ? deadline.getTime() : Date.parse(String(deadline));
  if (!isFinite(t)) return null;
  const remaining = Math.ceil((t - Date.now()) / 86_400_000);
  return Math.min(IDENT_WINDOW_DAYS, Math.max(0, IDENT_WINDOW_DAYS - remaining));
}

export function urgencyTier(deadline: string | Date | null | undefined): UrgencyTier {
  const day = elapsedDays(deadline);
  if (day == null) return "NONE";
  if (day >= 43) return "TERMINAL";
  if (day >= DISTRESS_START_DAY) return "DISTRESSED";
  return "STANDARD";
}

/** Sort weight — higher jumps the allocation queue. */
export function urgencyWeight(deadline: string | Date | null | undefined): number {
  const day = elapsedDays(deadline);
  if (day == null) return 0;
  if (day < DISTRESS_START_DAY) return day; // 0-34
  return 100 + day; // 135-145, always ahead of standard track
}

/** Escalated premium applied when matching inventory to a time-distressed box. */
export function escalatedFeeBps(baseBps: number, deadline: string | Date | null | undefined): number {
  const base = Number.isFinite(baseBps) && baseBps > 0 ? baseBps : 100;
  switch (urgencyTier(deadline)) {
    case "TERMINAL":
      return Math.min(1_000, Math.round(base * 2));
    case "DISTRESSED":
      return Math.min(1_000, Math.round(base * 1.5));
    default:
      return Math.round(base);
  }
}

export const CATEGORY_1031 = [
  "1031_RAW_LAND",
  "1031_TIMBER_TRACT",
  "1031_COMMERCIAL",
  "1031_MODULAR_PLOT",
  "1031_RESIDENTIAL",
] as const;
export type Category1031 = (typeof CATEGORY_1031)[number];
