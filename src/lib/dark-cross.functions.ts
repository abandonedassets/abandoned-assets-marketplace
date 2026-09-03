import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Admin view of the sealed order book. Criteria stay encrypted — never decrypted for the UI. */
export const getDarkCrossState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: intents } = await supabaseAdmin
      .from("dark_cross_intents")
      .select("id, api_key_id, box_id, intent_hash, max_notional, status, crossed_deal_id, crossed_at, expires_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    const { data: strikes } = await supabaseAdmin
      .from("buyer_buy_boxes")
      .select("id, label, latency_strikes, last_latency_strike_at")
      .gt("latency_strikes", 0)
      .order("latency_strikes", { ascending: false })
      .limit(20);

    const { data: locks } = await supabaseAdmin
      .from("closing_pipeline_items")
      .select("id, m2m_box_id, m2m_lock_ms, m2m_handshake_deadline")
      .not("m2m_handshake_deadline", "is", null)
      .order("m2m_handshake_deadline", { ascending: true })
      .limit(50);

    const { buildEscrowProof } = await import("@/lib/escrow-proof.server");
    const { verifyEscrowProof } = await import("@/lib/escrow-proof.server");
    const proof = await buildEscrowProof();
    const verified = verifyEscrowProof(proof);

    const rows = ((intents ?? []) as Array<Record<string, any>>).map((r) => ({
      id: String(r["id"]),
      hash: String(r["intent_hash"] ?? "").slice(0, 12),
      status: String(r["status"] ?? ""),
      max_notional: Number(r["max_notional"]) || 0,
      crossed_deal_id: r["crossed_deal_id"] as string | null,
      crossed_at: r["crossed_at"] as string | null,
      expires_at: r["expires_at"] as string | null,
      created_at: r["created_at"] as string | null,
    }));

    const now = Date.now();
    return {
      intents: rows,
      totals: {
        open: rows.filter((r) => r.status === "OPEN").length,
        crossed: rows.filter((r) => r.status === "CROSSED").length,
      },
      micro_tif: {
        live_locks: ((locks ?? []) as Array<Record<string, any>>).filter(
          (l) => new Date(l["m2m_handshake_deadline"]).getTime() > now,
        ).length,
        overdue: ((locks ?? []) as Array<Record<string, any>>).filter(
          (l) => new Date(l["m2m_handshake_deadline"]).getTime() <= now,
        ).length,
        strikes: (strikes ?? []) as Array<Record<string, any>>,
      },
      escrow_proof: { ...proof, verified: verified.ok, verify_reason: verified.reason },
    };
  });

/** Manual kick of the blind matcher (it also runs on the 60s heartbeat). */
export const runDarkCrossNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { runDarkCross, sweepMicroTif } = await import("@/lib/dark-cross.server");
    const tif = await sweepMicroTif();
    const cross = await runDarkCross(50);
    return { tif, cross };
  });
