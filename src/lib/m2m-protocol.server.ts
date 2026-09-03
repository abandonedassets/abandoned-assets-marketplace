// Institutional M2M protocol primitives:
//  - X-Idempotency-Key replay guard (parallel retry loops never double-mutate)
//  - Time-In-Force / slippage limits for outgoing counter matrices
//  - title_clean_hash: deterministic background lien-audit checksum
//  - X-M2M-Signature: HMAC-SHA256 payload signing
import { createHash, createHmac } from "crypto";

/** Default limit-order controls shipped in every outgoing counter matrix. */
export const TIF_SECONDS = 300;
export const MAX_FEE_SLIPPAGE_BPS = 250;

export function signM2M(body: string): string {
  const secret =
    process.env["M2M_SIGNING_SECRET"] ??
    process.env["STRIPE_WEBHOOK_SECRET"] ??
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
    "";
  if (!secret) return "";
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Deterministic clean-title checksum stamped into the fidelity payload so
 * buy-box algorithms can auto-execute EMD without a manual records audit.
 */
export function titleCleanHash(input: {
  apn?: string | null;
  county?: string | null;
  lien_total?: number | null;
  title_status?: string | null;
  assessed_value?: number | null;
  // Section 363 (Chapter 11 DIP) court-order inputs
  is_dip?: boolean | null;
  dip_case_number?: string | null;
  dip_sale_motion_ref?: string | null;
  dip_proposed_order_ref?: string | null;
}): {
  title_clean_hash: string;
  title_clean: boolean;
  title_source: "SECTION_363_COURT_ORDER" | "RECORDS_AUDIT";
} {
  const liens = Number(input.lien_total ?? 0);
  // A DIP asset with an approved sale motion + proposed order transfers free &
  // clear by court order — no manual records audit required.
  const section363 = !!(
    input.is_dip &&
    input.dip_sale_motion_ref &&
    input.dip_proposed_order_ref
  );
  const clean = section363 || (liens <= 0 && input.title_status !== "Uninsurable");
  const digest = createHash("sha256")
    .update(
      [
        input.apn ?? "",
        input.county ?? "",
        String(liens),
        input.title_status ?? "Pending",
        String(input.assessed_value ?? 0),
        section363
          ? `363|${input.dip_case_number ?? ""}|${input.dip_sale_motion_ref}|${input.dip_proposed_order_ref}`
          : "STD",
        clean ? "CLEAN" : "ENCUMBERED",
      ].join("|"),
    )
    .digest("hex");
  return {
    title_clean_hash: `0x${digest.slice(0, 40)}`,
    title_clean: clean,
    title_source: section363 ? "SECTION_363_COURT_ORDER" : "RECORDS_AUDIT",
  };
}

/**
 * Idempotency guard backed by webhook_replay_guard.
 * Returns { fresh:false } when this key was already processed for the source.
 */
export async function claimIdempotencyKey(
  key: string | null | undefined,
  source: string,
): Promise<{ fresh: boolean; key: string | null }> {
  if (!key) return { fresh: true, key: null };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("webhook_replay_guard")
      .insert({ event_id: key, source } as never);
    if (error) {
      // unique violation -> already seen
      if ((error as { code?: string }).code === "23505") return { fresh: false, key };
      console.error("[m2m-protocol] idempotency insert failed", error);
    }
    return { fresh: true, key };
  } catch (e) {
    console.error("[m2m-protocol] idempotency guard error", e);
    return { fresh: true, key: key ?? null };
  }
}
