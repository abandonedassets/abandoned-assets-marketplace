import { createHmac, timingSafeEqual } from "crypto";

const secret = () =>
  process.env["CLAIM_HASH_SECRET"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "claim-fallback";

/** Deterministic claim token for an asset — no DB column required. */
export function claimHash(assetId: string): string {
  return createHmac("sha256", secret()).update(`claim:${assetId}`).digest("hex").slice(0, 32);
}

export function verifyClaimHash(assetId: string, hash: string): boolean {
  const a = Buffer.from(claimHash(assetId));
  const b = Buffer.from(String(hash ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function claimUrl(assetId: string, base?: string): string {
  const site = base ?? process.env["PUBLIC_SITE_URL"] ?? "https://asset-weaver-30.lovable.app";
  return `${site}/claim/${claimHash(assetId)}?id=${assetId}`;
}
