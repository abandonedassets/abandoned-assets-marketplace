// Global Network Shield — restricts public hook access to partner IPs when
// IP_WHITELIST_ONLY is bound (comma-separated IPs or CIDRs). Disabled when unset.

function ipToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) + o;
  }
  return n >>> 0;
}

function cidrMatch(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = bitsRaw ? Number(bitsRaw) : 32;
  const ipN = ipToInt(ip);
  const baseN = ipToInt(base ?? "");
  if (ipN == null || baseN == null || !(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipN & mask) === (baseN & mask);
}

/** Returns null when allowed, or a 403 Response when the shield blocks the caller. */
export function ipShieldCheck(request: Request): Response | null {
  const raw = process.env.IP_WHITELIST_ONLY?.trim();
  if (!raw) return null; // shield disabled
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "";
  if (!ip) return Response.json({ ok: false, error: "shield_no_source_ip" }, { status: 403 });
  const rules = raw.split(",").map((r) => r.trim()).filter(Boolean);
  const allowed = rules.some((r) => (r.includes("/") ? cidrMatch(ip, r) : ip === r));
  if (allowed) return null;
  return Response.json({ ok: false, error: "shield_blocked" }, { status: 403 });
}
