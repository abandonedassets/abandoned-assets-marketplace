// Cryptographically signed deal packet manifest.
// SHA-256 per component + HMAC-SHA256 envelope signature over the canonical index.

import { createHash, createHmac } from "crypto";
import type { PacketArtifact } from "./packet-builder.server";

export type ManifestComponent = {
  filename: string;
  content_type: string;
  bytes: number;
  sha256: string;
  role: string;
};

export type PacketManifest = {
  manifest_version: "INST-PACKET-1.0";
  packet_id: string;
  deal_id: string;
  generated_at: string;
  originator: string;
  components: ManifestComponent[];
  merkle_root: string;
  signature: { alg: "HMAC-SHA256"; key_id: string; value: string };
};

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256")
    .update(typeof bytes === "string" ? bytes : Buffer.from(bytes))
    .digest("hex");
}

function roleFor(filename: string): string {
  if (filename.startsWith("offering_memorandum")) return "OFFERING_MEMORANDUM";
  if (filename.startsWith("loi_")) return "LETTER_OF_INTENT";
  if (filename.startsWith("title_commitment")) return "TITLE_COMMITMENT";
  if (filename.startsWith("financial_model")) return "FINANCIAL_MODEL_10YR";
  return "SUPPORTING_DOCUMENT";
}

function signingKey(): { key: string; keyId: string } {
  const key =
    process.env["PACKET_SIGNING_KEY"] ||
    process.env["M2M_HMAC_SECRET"] ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    "reeledge-packet-dev-key";
  return { key, keyId: sha256(key).slice(0, 16) };
}

/** Deterministic packet id used in the [ACQUISITIONS-INTAKE] subject hash. */
export function packetId(dealId: string, generatedAt: string): string {
  return `ID-${sha256(`${dealId}:${generatedAt}`).slice(0, 12).toUpperCase()}`;
}

export function buildManifest(
  dealId: string,
  artifacts: PacketArtifact[],
  extra?: Record<string, unknown>,
): PacketManifest {
  const generated_at = new Date().toISOString();
  const components: ManifestComponent[] = artifacts.map((a) => ({
    filename: a.filename,
    content_type: a.content_type,
    bytes: a.bytes.byteLength,
    sha256: sha256(a.bytes),
    role: roleFor(a.filename),
  }));

  const merkle_root = sha256(
    components
      .map((c) => `${c.filename}:${c.sha256}`)
      .sort()
      .join("|"),
  );

  const { key, keyId } = signingKey();
  const canonical = JSON.stringify({ dealId, generated_at, merkle_root, extra: extra ?? {} });
  const value = createHmac("sha256", key).update(canonical).digest("hex");

  return {
    manifest_version: "INST-PACKET-1.0",
    packet_id: packetId(dealId, generated_at),
    deal_id: dealId,
    generated_at,
    originator: "ReelEdge Acquisitions",
    components,
    merkle_root,
    signature: { alg: "HMAC-SHA256", key_id: keyId, value },
    ...(extra ? { deal: extra } : {}),
  } as PacketManifest;
}

export function manifestArtifact(manifest: PacketManifest): PacketArtifact {
  return {
    filename: `manifest_${manifest.packet_id}.json`,
    content_type: "application/json",
    bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  };
}

export function verifyManifest(manifest: PacketManifest): boolean {
  try {
    const { key } = signingKey();
    const canonical = JSON.stringify({
      dealId: manifest.deal_id,
      generated_at: manifest.generated_at,
      merkle_root: manifest.merkle_root,
      extra: (manifest as any).deal ?? {},
    });
    return createHmac("sha256", key).update(canonical).digest("hex") === manifest.signature.value;
  } catch {
    return false;
  }
}
