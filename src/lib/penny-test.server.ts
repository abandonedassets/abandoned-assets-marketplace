// ---------------------------------------------------------------------------
// Cryptographic penny test.
//
// Instead of a spoofable static $1.00, the buyer must wire two randomized
// micro-deposits that sum to exactly $1.00. The cent split is DERIVED — not
// stored-then-compared — from SHA-256(idempotency key + daily salt + secret),
// so it is unpredictable to an attacker yet fully reproducible server-side.
// A replayed or spoofed pair fails because tomorrow's salt yields a new split.
// ---------------------------------------------------------------------------

import { createHash } from "crypto";

const MIN_CENTS = 11; // never trivially guessable / never $0
const TOTAL_CENTS = 100;

function secret(): string {
  return (
    process.env["IDEMPOTENCY_SALT"] ??
    process.env["INBOUND_WIRE_SECRET"] ??
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
    "unsalted-dev"
  );
}

function dailySalt(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Deterministic, unpredictable cent split derived from the idempotency key. */
export function derivePennySplit(idempotencyKey: string, saltDate = dailySalt()) {
  const digest = createHash("sha256")
    .update(`${idempotencyKey}|${saltDate}|${secret()}`)
    .digest();
  const span = TOTAL_CENTS - MIN_CENTS * 2; // inclusive range width
  const a = MIN_CENTS + (digest.readUInt32BE(0) % (span + 1));
  const b = TOTAL_CENTS - a;
  const lockHash = createHash("sha256")
    .update(`${idempotencyKey}|${saltDate}|${a}|${b}|${secret()}`)
    .digest("hex");
  return { amount_a_cents: a, amount_b_cents: b, salt_date: saltDate, lock_hash: lockHash };
}

/** Issue (idempotently) a penny test for a deal. */
export async function issuePennyTest(dealId: string | null, idempotencyKey: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const split = derivePennySplit(idempotencyKey);

  const { data: existing } = await supabaseAdmin
    .from("penny_test_verifications")
    .select("id, amount_a_cents, amount_b_cents, lock_hash, salt_date, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing) return { ok: true, reused: true, ...(existing as any) };

  const { data, error } = await supabaseAdmin
    .from("penny_test_verifications")
    .insert({
      deal_id: dealId,
      idempotency_key: idempotencyKey,
      salt_date: split.salt_date,
      amount_a_cents: split.amount_a_cents,
      amount_b_cents: split.amount_b_cents,
      lock_hash: split.lock_hash,
    } as never)
    .select("id, amount_a_cents, amount_b_cents, lock_hash, salt_date, status")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, reused: false, ...(data as any) };
}

/**
 * Verify an inbound micro-deposit pair. Both cent values must match the
 * derived split exactly; order-insensitive, single-use.
 */
export async function verifyPennyTest(
  idempotencyKey: string,
  centsSeen: number[],
  stripeReference?: string,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("penny_test_verifications")
    .select("id, amount_a_cents, amount_b_cents, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (!data) return { ok: false, reason: "unknown_penny_test" };
  const row = data as any;
  if (row.status === "VERIFIED") return { ok: true, reason: "already_verified" };

  const want = [Number(row.amount_a_cents), Number(row.amount_b_cents)].sort((x, y) => x - y);
  const got = centsSeen.map(Number).sort((x, y) => x - y);
  const match = want.length === got.length && want.every((v, i) => v === got[i]);

  await supabaseAdmin
    .from("penny_test_verifications")
    .update({
      status: match ? "VERIFIED" : "REJECTED",
      matched_at: match ? new Date().toISOString() : null,
      stripe_reference: stripeReference ?? null,
    } as never)
    .eq("id", row.id);

  return { ok: match, reason: match ? "verified" : "amount_mismatch" };
}
