// Client-safe FedWire transit ETA helper. Read-only projection — no backend state.

const FED_HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-24",
]);

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function isBankingDay(d: Date) {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6 && !FED_HOLIDAYS.has(iso(d));
}

/** Add N business days, skipping weekends and US federal banking holidays. */
export function addBankingDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (isBankingDay(d)) left--;
  }
  return d;
}

/** Business days remaining between now and the target date. */
export function bankingDaysUntil(target: Date, now = new Date()): number {
  if (target.getTime() <= now.getTime()) return 0;
  let count = 0;
  const d = new Date(now);
  while (iso(d) < iso(target)) {
    d.setDate(d.getDate() + 1);
    if (isBankingDay(d)) count++;
  }
  return count;
}

export type WireEta = {
  arrival: Date;
  businessDaysLeft: number;
  label: string;
};

/**
 * FedWire standard settlement: funds post T+1, worst case T+2 banking days
 * from the moment the asset entered WIRE_PENDING_VERIFICATION.
 */
export function wireEta(enteredAt: string | Date | null | undefined, now = new Date()): WireEta {
  const start = enteredAt ? new Date(enteredAt) : now;
  const base = Number.isNaN(start.getTime()) ? now : start;
  const arrival = addBankingDays(base, 2);
  const left = bankingDaysUntil(arrival, now);

  let label: string;
  if (left <= 0) label = "Expected: Today";
  else if (left === 1) label = "Expected: Tomorrow";
  else if (left === 2) label = "Expected: 2 Business Days";
  else label = `Expected: ${left} Business Days`;

  if (left > 0 && left <= 3) {
    const weekday = arrival.toLocaleDateString("en-US", { weekday: "long" });
    label = `${label} (${weekday})`;
  }

  return { arrival, businessDaysLeft: left, label };
}
