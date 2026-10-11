import {
  decodeCanonicalEd25519Signature,
  signatureDigest,
} from "./bridge-signature.ts";

Deno.test("accepts a canonical 64-byte Ed25519 signature", () => {
  const bytes = new Uint8Array(64);
  const encoded = btoa(String.fromCharCode(...bytes));
  const decoded = decodeCanonicalEd25519Signature(encoded);
  if (!decoded || decoded.byteLength !== 64) {
    throw new Error("canonical signature should decode to exactly 64 bytes");
  }
});

Deno.test("rejects unpadded and malformed signature encodings", () => {
  const encoded = btoa(String.fromCharCode(...new Uint8Array(64)));
  for (const candidate of [encoded.replace(/=+$/, ""), encoded + "=", "not-base64", "AA=="]) {
    if (decodeCanonicalEd25519Signature(candidate) !== null) {
      throw new Error("noncanonical or wrong-length signature was accepted");
    }
  }
});

Deno.test("rejects alternate Base64 pad bits for identical signature bytes", () => {
  const canonical = btoa(String.fromCharCode(...new Uint8Array(64)));
  const alternate = canonical.slice(0, -3) + "B==";
  if (decodeCanonicalEd25519Signature(alternate) !== null) {
    throw new Error("noncanonical Base64 representation was accepted");
  }
});

Deno.test("replay digest is based on decoded signature bytes", async () => {
  const encoded = btoa(String.fromCharCode(...new Uint8Array(64)));
  const digest = await signatureDigest(encoded);
  if (digest !== "f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b") {
    throw new Error("unexpected SHA-256 digest for 64 zero bytes");
  }
});
