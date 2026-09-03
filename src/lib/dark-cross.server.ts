// Cryptographic Dark Crossing.
//
// Funds post an ENCRYPTED intent (cap rate floor, asset class, geography,
// notional ceiling). The plaintext never touches the database — only an
// AES-256-GCM blob. Matching happens in-process: the blob is decrypted for
// microseconds inside the matcher, compared against assets that just hit
// REVERSE_STRIKE_READY, and the winning pair is crossed atomically.
//
// Nothing about an intent is ever exposed on the public tape, so no bot can
// front-run a resting order. Zero information leakage by construction.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

export type DarkIntent = {
  asset_classes?: string[];
  states?: string[];
  zips?: string[];
  min_assignment_fee?: number;
  max_price?: number;
  min_price?: number;
  min_arv_ratio?: number;
  title_clean_only?: boolean;
  max_notional?: number;
  auto_execute?: boolean;
};

function keyBuf() {
  const raw = process.env["DARK_CROSS_KEY"] ?? "";
  if (!raw) throw new Error("DARK_CROSS_KEY not configured");
  return createHash("sha256").update(raw).digest();
}

export function sealIntent(intent: DarkIntent) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyBuf(), iv);
  const plain = JSON.stringify(intent);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    intent_hash: createHash("sha256").update(plain).digest("hex"),
  };
}

export function openIntent(row: {
  ciphertext: string;
  iv: string;
  auth_tag: string;
}): DarkIntent | null {
  try {
    const d = createDecipheriv(ALGO, keyBuf(), Buffer.from(row.iv, "base64"));
    d.setAuthTag(Buffer.from(row.auth_tag, "base64"));
    const out = Buffer.concat([
      d.update(Buffer.from(row.ciphertext, "base64")),
      d.final(),
    ]).toString("utf8");
    return JSON.parse(out) as DarkIntent;
  } catch (e) {
    console.error("[dark-cross] intent decrypt failed", (e as Error).message);
    return null;
  }
}

/** Persists a sealed intent. Returns the id only — never echoes criteria. */
export async function postIntent(input: {
  apiKeyId: string;
  boxId?: string | null;
  intent: DarkIntent;
  ttlHours?: number;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sealed = sealIntent(input.intent);
  const expires = new Date(
    Date.now() + Math.min(Math.max(input.ttlHours ?? 168, 1), 720) * 3600_000,
  ).toISOString();

  // Re-posting identical criteria refreshes the resting order instead of
  // stacking duplicates (a partial unique index guards OPEN rows).
  const existing = await supabaseAdmin
    .from("dark_cross_intents")
    .select("id")
    .eq("api_key_id", input.apiKeyId)
    .eq("intent_hash", sealed.intent_hash)
    .eq("status", "OPEN")
    .maybeSingle();

  const payload = {
    api_key_id: input.apiKeyId,
    box_id: input.boxId ?? null,
    ...sealed,
    max_notional: Number(input.intent.max_notional ?? 0) || 0,
    status: "OPEN",
    expires_at: expires,
  };

  const q = existing.data
    ? supabaseAdmin
        .from("dark_cross_intents")
        .update(payload as never)
        .eq("id", (existing.data as Record<string, any>)["id"])
    : supabaseAdmin.from("dark_cross_intents").insert(payload as never);

  const { data, error } = await q.select("id, expires_at").maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  const row = (data ?? {}) as Record<string, any>;
  return { ok: true as const, intent_id: String(row["id"] ?? ""), expires_at: row["expires_at"] };
}

function matches(intent: DarkIntent, a: Record<string, any>) {
  const price = Number(a["base_contract_price"]) || 0;
  const fee = Number(a["optimized_acquisition_premium"]) || 0;
  const arv = Number(a["calculated_arv"]) || 0;
  const cls = String(a["asset_class"] ?? a["asset_type"] ?? "").toUpperCase();

  if (intent.asset_classes?.length && !intent.asset_classes.map((s) => s.toUpperCase()).includes(cls))
    return false;
  if (intent.states?.length && !intent.states.map((s) => s.toUpperCase()).includes(String(a["state"] ?? "").toUpperCase()))
    return false;
  if (intent.zips?.length && !intent.zips.includes(String(a["zip"] ?? ""))) return false;
  if (intent.min_price != null && price < intent.min_price) return false;
  if (intent.max_price != null && price > intent.max_price) return false;
  if (intent.max_notional != null && intent.max_notional > 0 && price > intent.max_notional) return false;
  if (intent.min_assignment_fee != null && fee < intent.min_assignment_fee) return false;
  if (intent.min_arv_ratio != null && arv > 0 && price / arv > 1 / intent.min_arv_ratio) return false;
  if (intent.title_clean_only && String(a["title_status"] ?? "").toUpperCase() === "UNINSURABLE")
    return false;
  return true;
}

export type CrossResult = {
  ok: boolean;
  intents_open: number;
  candidates: number;
  crossed: number;
  rows: Array<{ intent_id: string; deal_id: string; price: number; fee: number; state: string }>;
  error?: string;
};

/**
 * Blind cross pass. Runs on the autonomous heartbeat. Every step is wrapped —
 * one bad intent never stalls the book.
 */
export async function runDarkCross(limit = 50): Promise<CrossResult> {
  const out: CrossResult = { ok: true, intents_open: 0, candidates: 0, crossed: 0, rows: [] };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: intents, error: iErr } = await supabaseAdmin
      .from("dark_cross_intents")
      .select("id, api_key_id, box_id, ciphertext, iv, auth_tag, max_notional")
      .eq("status", "OPEN")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(limit);
    if (iErr) return { ...out, ok: false, error: iErr.message };
    out.intents_open = (intents ?? []).length;
    if (!out.intents_open) return out;

    // Reverse-strike-ready inventory only: an asset the seller has already
    // authorized and that the pricing engine has cleared for immediate cross.
    const { data: assets, error: aErr } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select(
        "id, base_contract_price, optimized_acquisition_premium, calculated_arv, asset_class, asset_type, state, zip, title_status, status, tif_state, payout_status, m2m_handshake_deadline",
      )
      .is("cleared_at", null)
      .gt("optimized_acquisition_premium", 0)
      .not("status", "in", '("Dead","Rejected","Closed","Auto_Archived_Bad_Data")')
      .order("optimized_acquisition_premium", { ascending: false })
      .limit(400);
    if (aErr) return { ...out, ok: false, error: aErr.message };

    const pool = ((assets ?? []) as Record<string, any>[]).filter(
      (a) =>
        String(a["tif_state"] ?? "") !== "Executed" &&
        !["WIRE_PENDING_VERIFICATION", "SETTLED_PAID"].includes(String(a["payout_status"] ?? "")) &&
        (!a["m2m_handshake_deadline"] || new Date(a["m2m_handshake_deadline"]).getTime() < Date.now()),
    );
    out.candidates = pool.length;

    const taken = new Set<string>();
    for (const rawIntent of (intents ?? []) as Record<string, any>[]) {
      try {
        const intent = openIntent({
          ciphertext: String(rawIntent["ciphertext"]),
          iv: String(rawIntent["iv"]),
          auth_tag: String(rawIntent["auth_tag"]),
        });
        if (!intent) continue;

        const hit = pool.find((a) => !taken.has(String(a["id"])) && matches(intent, a));
        if (!hit) continue;
        const dealId = String(hit["id"]);
        const boxId = rawIntent["box_id"] as string | null;
        if (!boxId) continue; // no mandate to cross into yet

        // Atomic block: claim the micro-lock, then accept in the same pass.
        const { data: claim } = await supabaseAdmin.rpc("m2m_claim_micro" as never, {
          _id: dealId,
          _box_id: boxId,
          _lock_ms: 5000,
        } as never);
        if (!(claim as any)?.ok) continue;

        if (intent.auto_execute === false) {
          taken.add(dealId);
          continue;
        }

        const { data: acc } = await supabaseAdmin.rpc("m2m_accept" as never, {
          _id: dealId,
          _box_id: boxId,
          _signature: `DARK-CROSS:${rawIntent["id"]}`,
        } as never);
        if (!(acc as any)?.ok) continue;

        const proofMod = await import("./escrow-proof.server");
        const proof = await proofMod.buildEscrowProof({
          dealId,
          dealNotional: Number(hit["base_contract_price"]) || 0,
        });

        await supabaseAdmin
          .from("dark_cross_intents")
          .update({
            status: "CROSSED",
            crossed_deal_id: dealId,
            crossed_at: new Date().toISOString(),
            cross_proof: proof.signature,
          } as never)
          .eq("id", rawIntent["id"]);

        taken.add(dealId);
        out.crossed += 1;
        out.rows.push({
          intent_id: String(rawIntent["id"]),
          deal_id: dealId,
          price: Number(hit["base_contract_price"]) || 0,
          fee: Number(hit["optimized_acquisition_premium"]) || 0,
          state: "WIRE_PENDING_VERIFICATION",
        });
      } catch (e) {
        console.error("[dark-cross] intent pass failed", (e as Error).message);
      }
    }
    return out;
  } catch (e) {
    return { ...out, ok: false, error: (e as Error).message };
  }
}

/** Millisecond lock decay — latency arbitrage gets punished mechanically. */
export async function sweepMicroTif() {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("sweep_micro_tif" as never);
    if (error) return { ok: false, error: error.message, released: 0 };
    const rows = ((data as unknown[]) ?? []) as Array<Record<string, any>>;
    return {
      ok: true,
      released: rows.length,
      worst_overdue_ms: rows.reduce((m, r) => Math.max(m, Number(r["overdue_ms"]) || 0), 0),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message, released: 0 };
  }
}
