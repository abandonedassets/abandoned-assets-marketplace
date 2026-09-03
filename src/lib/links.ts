// Wraps buyer-facing URLs in the local /track redirect so every open is logged.
const FALLBACK_BASE = "https://project--dd9b0412-ab83-4f6e-86a4-cd1dedd921cc.lovable.app";

export function appBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return (
    (typeof process !== "undefined" ? process.env?.PUBLIC_BASE_URL : undefined) ||
    FALLBACK_BASE
  );
}

export function generateTrackedEsignLink(
  buyerId: string,
  assetId: string,
  rawEsignUrl: string,
  baseUrl = appBaseUrl(),
): string {
  const params = new URLSearchParams({
    buyer: buyerId ?? "",
    asset: assetId ?? "",
    target: rawEsignUrl ?? "",
  });
  return `${baseUrl}/track?${params.toString()}`;
}

/** Generic tracked wrapper for invoices, VDR dossiers, wire packets, etc. */
export function generateTrackedLink(input: {
  assetId: string;
  buyer?: string;
  target: string;
  baseUrl?: string;
}): string {
  return generateTrackedEsignLink(
    input.buyer ?? "",
    input.assetId,
    input.target,
    input.baseUrl ?? appBaseUrl(),
  );
}
