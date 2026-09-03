// Secure magic-link tokens for seller authorization portal.
// HMAC-SHA256(assetId) truncated to 32 hex chars. Server-only.

import { appBaseUrl } from "./links";

function secret(): string {
  return process.env["SELLER_LINK_SECRET"] || process.env["SUPABASE_SERVICE_ROLE_KEY"] || "dev-secret";
}

export async function sellerToken(assetId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`asset:${assetId}`));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export async function verifySellerToken(assetId: string, token: string): Promise<boolean> {
  const expected = await sellerToken(assetId);
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export async function sellerAuthUrl(assetId: string, baseUrl = appBaseUrl()): Promise<string> {
  return `${baseUrl}/authorize-asset/${assetId}?token=${await sellerToken(assetId)}`;
}
