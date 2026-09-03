import { createFileRoute } from "@tanstack/react-router";

// Autonomous settlement sweep — Bluevine rails only (Stripe removed).
// 1. Truth-sync: any deal with a settled Bluevine reference is Funds-Cleared.
// 2. Auto-disbursement: cleared deal-tape proceeds wire to the Bluevine
//    business account via payoutAssignmentFee(). Fail-forward per record.

export const Route = createFileRoute("/api/public/hooks/autonomous-sync")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { bluevineStatus } = await import("@/lib/bluevine-rails.server");

        const result = {
          rail: "bluevine" as const,
          banking: await bluevineStatus(),
          synced: 0,
          set_cleared: 0,
          payouts_executed: 0,
          payout_usd: 0,
          errors: [] as string[],
        };

        if (!result.banking.coordinates_ready) {
          return Response.json(
            { ...result, ok: false, error: "bluevine_coordinates_missing" },
            { status: 200 },
          );
        }

        // ---------- 1. TRUTH-SYNC ----------
        const { data: rows } = await supabaseAdmin
          .from("closing_pipeline_items")
          .select("id, status, cleared_at, stripe_session_id")
          .not("cleared_at", "is", null)
          .neq("status", "Funds-Cleared")
          .limit(500);

        for (const row of rows || []) {
          try {
            await supabaseAdmin
              .from("closing_pipeline_items")
              .update({ status: "Funds-Cleared" })
              .eq("id", row.id);
            result.set_cleared++;
            result.synced++;
          } catch (e) {
            result.errors.push(`sync ${row.id}: ${e instanceof Error ? e.message : "err"}`);
          }
        }

        // ---------- 2. AUTO DISBURSEMENT TO BLUEVINE ----------
        try {
          const { data: cfg } = await supabaseAdmin
            .from("system_config")
            .select("key, value")
            .in("key", ["autonomous_payouts_enabled", "min_payout_threshold_usd"]);
          const cfgMap = Object.fromEntries((cfg || []).map((c) => [c.key, c.value]));
          const { reconciliationHalted } = await import("@/lib/ledger-reconcile.server");
          const halted = await reconciliationHalted();
          const enabled =
            !halted &&
            (cfgMap["autonomous_payouts_enabled"] === undefined ||
              cfgMap["autonomous_payouts_enabled"] === true ||
              cfgMap["autonomous_payouts_enabled"] === "true");
          const thresholdUsd = Number(cfgMap["min_payout_threshold_usd"] ?? 0);

          if (enabled) {
            const { data: due } = await supabaseAdmin
              .from("closing_pipeline_items")
              .select("id, optimized_acquisition_premium, payout_transfer_id, cleared_at")
              .not("cleared_at", "is", null)
              .is("payout_transfer_id", null)
              .gte("optimized_acquisition_premium", thresholdUsd)
              .limit(100);

            const { payoutAssignmentFee } = await import("@/lib/payout.server");
            const { checkVelocity } = await import("@/lib/velocity-breaker.server");
            for (const d of due || []) {
              try {
                const v = await checkVelocity(Number(d.optimized_acquisition_premium) || 0);
                if (!v.allowed) {
                  result.errors.push(`velocity_halt: ${v.reason ?? "cap_breached"}`);
                  break;
                }
                const p = await payoutAssignmentFee(d.id as string);
                if (p.ok) {
                  result.payouts_executed++;
                  result.payout_usd += p.amount;
                }
              } catch (e) {
                result.errors.push(
                  `payout ${d.id}: ${e instanceof Error ? e.message : "err"}`,
                );
              }
            }
          }
        } catch (e) {
          result.errors.push(`payout: ${e instanceof Error ? e.message : "err"}`);
        }

        return Response.json({ ok: true, ...result });
      },
    },
  },
});
