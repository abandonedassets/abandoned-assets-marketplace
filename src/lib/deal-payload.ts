export type ParsedDealPayload = {
  contractMode: string | null;
  fee: number;
};

const objectValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const positiveNumber = (...values: unknown[]): number => {
  for (const value of values) {
    const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
};

/** Normalize legacy assignment and machine-issued double-close payloads. */
export function parseDealPayload(payload: unknown): ParsedDealPayload {
  const root = objectValue(payload) ?? {};
  const economics = objectValue(root["economics"]) ?? {};
  const terms = objectValue(root["terms"]) ?? {};
  const mode = String(
    root["contract_mode"] ?? terms["contract_mode"] ?? root["contractMode"] ?? "",
  )
    .trim()
    .toUpperCase();

  return {
    contractMode: mode || null,
    fee: positiveNumber(
      root["spread_usd"],
      terms["spread_usd"],
      root["assignment_fee"],
      root["assignment_fee_usd"],
      economics["spread_usd"],
      economics["assignment_fee"],
      economics["assignment_fee_usd"],
    ),
  };
}