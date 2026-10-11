export function decodeCanonicalEd25519Signature(value: string): Uint8Array | null {
  // Ed25519 signatures are exactly 64 bytes. Require canonical padded Base64 so
  // one valid signature cannot have multiple textual replay-cache identities.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return null;
  }

  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    if (bytes.byteLength !== 64) return null;

    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    if (btoa(binary) !== value) return null;

    return bytes;
  } catch {
    return null;
  }
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

export async function signatureDigest(value: string): Promise<string | null> {
  const signature = decodeCanonicalEd25519Signature(value);
  if (!signature) return null;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", asArrayBuffer(signature)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
